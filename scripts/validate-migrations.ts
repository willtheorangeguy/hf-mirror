#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import path from "path";
import {
  repairDuplicateSsoColumns,
  repairStrandedBetterAuth17Schema,
  restoreSsoDataAfter0013,
} from "../src/lib/db/migration-repairs";

type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
};

type Migration = {
  entry: JournalEntry;
  statements: string[];
};

type UpgradeFixture = {
  seed: (db: Database) => void;
  verify: (db: Database) => void;
};

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

const migrationsFolder = path.join(process.cwd(), "drizzle");
const migrations = loadMigrations();
const latestMigration = migrations.at(-1);

/**
 * Known SQLite limitations that Drizzle-kit's auto-generated migrations
 * can violate. Each rule is checked against every SQL statement.
 */
const SQLITE_LINT_RULES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /ALTER\s+TABLE\s+\S+\s+ADD\s+(?:COLUMN\s+)?\S+[^;]*DEFAULT\s*\(/i,
    message:
      "ALTER TABLE ADD COLUMN with an expression default (e.g. DEFAULT (unixepoch())) " +
      "is not allowed in SQLite. Use the table-recreation pattern instead " +
      "(CREATE new table, INSERT SELECT, DROP old, RENAME).",
  },
  {
    pattern: /ALTER\s+TABLE\s+\S+\s+ADD\s+(?:COLUMN\s+)?\S+[^;]*DEFAULT\s+CURRENT_(TIME|DATE|TIMESTAMP)\b/i,
    message:
      "ALTER TABLE ADD COLUMN with DEFAULT CURRENT_TIME/CURRENT_DATE/CURRENT_TIMESTAMP " +
      "is not allowed in SQLite. Use the table-recreation pattern instead.",
  },
];

function loadMigrations(): Migration[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };

  return journal.entries.map((entry) => {
    const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const statements = readFileSync(migrationPath, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    return { entry, statements };
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function runMigration(db: Database, migration: Migration) {
  db.run("BEGIN");

  try {
    for (const statement of migration.statements) {
      db.run(statement);
    }

    db.run("COMMIT");
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {
      // Ignore rollback errors so the original failure is preserved.
    }

    throw error;
  }
}

function runMigrations(db: Database, selectedMigrations: Migration[]) {
  for (const migration of selectedMigrations) {
    runMigration(db, migration);
  }
}

const MIGRATION_0012_TIMESTAMP = 1774062000000;
const MIGRATION_0013_TIMESTAMP = 1780377747526;

/**
 * Reproduce the issue #312 crash state — sso_providers already carries
 * saml_config / domain_verified before migration 0013 runs (stranded on an
 * intermediate build), with __drizzle_migrations recorded only through 0012 —
 * and verify repairDuplicateSsoColumns()/restoreSsoDataAfter0013() let the
 * canonical 0013 run while preserving real SAML provider data.
 */
function validateBroken0013Repair() {
  const migration0013 = migrations.find((m) => m.entry.tag === "0013_slim_galactus");
  if (!migration0013) return; // 0013 not present (shouldn't happen) — nothing to test.

  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations.slice(0, 13)); // 0000-0012

    // A real upgraded instance has a __drizzle_migrations table recorded
    // through 0012 but not 0013.
    db.run(
      "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
    );
    db.run("INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES ('through-0012', ?)", [
      MIGRATION_0012_TIMESTAMP,
    ]);

    // Stranded columns from the intermediate build.
    db.run("ALTER TABLE sso_providers ADD saml_config text");
    db.run("ALTER TABLE sso_providers ADD domain_verified integer DEFAULT true NOT NULL");

    db.run("INSERT INTO users (id, email, username, name) VALUES ('u1', 'u1@example.com', 'u1', 'User One')");
    const samlJson = '{"entryPoint":"https://idp.example.com/sso","cert":"ABC123"}';
    db.run(
      "INSERT INTO sso_providers (id, issuer, domain, oidc_config, user_id, provider_id, saml_config, domain_verified) VALUES ('oidc1', 'https://idp', 'a.com', '{}', 'u1', 'p-oidc', NULL, 1)",
    );
    db.run(
      "INSERT INTO sso_providers (id, issuer, domain, oidc_config, user_id, provider_id, saml_config, domain_verified) VALUES ('saml1', 'https://idp', 'b.com', '{}', 'u1', 'p-saml', ?, 1)",
      [samlJson],
    );
    db.run(
      "INSERT INTO sso_providers (id, issuer, domain, oidc_config, user_id, provider_id, saml_config, domain_verified) VALUES ('unv1', 'https://idp', 'c.com', '{}', 'u1', 'p-unv', NULL, 0)",
    );

    const preserved = repairDuplicateSsoColumns(db);

    const colsAfterRepair = (db.query("PRAGMA table_info(sso_providers)").all() as TableInfoRow[]).map(
      (c) => c.name,
    );
    assert(!colsAfterRepair.includes("saml_config"), "Expected repair to drop stranded saml_config column");
    assert(
      !colsAfterRepair.includes("domain_verified"),
      "Expected repair to drop stranded domain_verified column",
    );
    const preservedIds = preserved.map((r) => r.id).sort();
    assert(
      preservedIds.length === 2 && preservedIds[0] === "saml1" && preservedIds[1] === "unv1",
      `Expected SAML + unverified rows to be preserved, got ${JSON.stringify(preservedIds)}`,
    );

    // The canonical 0013 must now run without a duplicate-column error.
    runMigration(db, migration0013);
    restoreSsoDataAfter0013(db, preserved);

    const rows = db
      .query("SELECT id, saml_config, domain_verified FROM sso_providers ORDER BY id")
      .all() as Array<{ id: string; saml_config: string | null; domain_verified: number }>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    assert(byId.oidc1.saml_config === null, "Expected OIDC provider saml_config to remain NULL");
    assert(byId.oidc1.domain_verified === 1, "Expected OIDC provider domain_verified default 1");
    assert(byId.saml1.saml_config === samlJson, "Expected SAML provider config to be preserved");
    assert(byId.saml1.domain_verified === 1, "Expected SAML provider domain_verified preserved as 1");
    assert(byId.unv1.saml_config === null, "Expected unverified provider saml_config NULL");
    assert(byId.unv1.domain_verified === 0, "Expected explicit domain_verified=0 to be preserved");

    // Idempotency: 0013 is now applied, so a re-run of the repair is a no-op.
    db.run("INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES ('through-0013', ?)", [
      MIGRATION_0013_TIMESTAMP,
    ]);
    const secondPass = repairDuplicateSsoColumns(db);
    assert(secondPass.length === 0, "Expected repair to no-op once migration 0013 is recorded");
    const colsAfterSecondPass = (
      db.query("PRAGMA table_info(sso_providers)").all() as TableInfoRow[]
    ).map((c) => c.name);
    assert(
      colsAfterSecondPass.includes("saml_config") && colsAfterSecondPass.includes("domain_verified"),
      "Expected columns to remain intact on the no-op second pass",
    );
  } finally {
    db.close();
  }
}

const MIGRATION_0015_TIMESTAMP = 1788333701612;

/**
 * Reproduce a database that booted the reverted better-auth 1.7.0-rc.4 build:
 * migrations recorded through 0015, but the three rc tables and some of the
 * rc columns already present. Migration 0016 must fail on it as-is, and
 * repairStrandedBetterAuth17Schema() must reconcile it so 0016 then runs and
 * backfills account issuers.
 */
function validateStranded0016Repair() {
  const migration0016 = migrations.find((m) => m.entry.tag === "0016_better_auth_1_7");
  if (!migration0016) return;

  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations.slice(0, 16)); // 0000-0015
    db.run(
      "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
    );
    db.run("INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES ('through-0015', ?)", [
      MIGRATION_0015_TIMESTAMP,
    ]);

    // Leftovers from the rc build.
    db.run("CREATE TABLE oauth_client_assertions (id text PRIMARY KEY NOT NULL, expires_at integer NOT NULL)");
    db.run("CREATE TABLE oauth_resources (id text PRIMARY KEY NOT NULL, identifier text NOT NULL, name text NOT NULL)");
    db.run("ALTER TABLE oauth_clients ADD client_discovery_id text");
    db.run("ALTER TABLE oauth_access_tokens ADD resources text");

    db.run("INSERT INTO users (id, email, username, name) VALUES ('u-rc', 'rc@example.com', 'rc', 'RC User')");
    db.run("INSERT INTO accounts (id, account_id, user_id, provider_id, password) VALUES ('acct-rc', 'u-rc', 'u-rc', 'credential', 'hashed')");

    // As-is, 0016 cannot run: the CREATE TABLE collides.
    let failedAsIs = false;
    try {
      runMigration(db, migration0016);
    } catch {
      failedAsIs = true;
    }
    assert(failedAsIs, "Expected migration 0016 to fail on the rc leftovers without the repair");

    const dropped = repairStrandedBetterAuth17Schema(db);
    assert(dropped === 4, `Expected the repair to drop 2 tables and 2 columns, dropped ${dropped}`);

    runMigration(db, migration0016);

    const account = db
      .query("SELECT issuer FROM accounts WHERE id = 'acct-rc'")
      .get() as { issuer: string } | null;
    assert(account?.issuer === "local:credential", `Expected the credential account to be backfilled after the repair, got ${account?.issuer}`);
    const clientCols = (db.query("PRAGMA table_info(oauth_clients)").all() as TableInfoRow[]).map((c) => c.name);
    assert(clientCols.includes("client_discovery_id") && clientCols.includes("jwks_uri"), "Expected 0016 to re-add the oauth_clients columns in full");
    db.run("INSERT INTO oauth_client_assertions (id, expires_at) VALUES ('jti-rc', 1)");

    // Idempotency: with 0016 recorded the repair is a no-op.
    db.run("INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES ('through-0016', ?)", [
      1788336988526,
    ]);
    assert(repairStrandedBetterAuth17Schema(db) === 0, "Expected the repair to no-op once migration 0016 is recorded");
  } finally {
    db.close();
  }
}
const latestUpgradeFixtures: Record<string, UpgradeFixture> = {
"0021_huggingface": {
    seed(db) {
      db.run("INSERT INTO users (id, email, username, name) VALUES ('u-hf21', 'hf21@example.test', 'alice', 'HF')");
      db.run("INSERT INTO configs (id,user_id,name,github_config,gitea_config,schedule_config,cleanup_config) VALUES ('cfg-hf21','u-hf21','HF','{\"provider\":\"huggingface\",\"owner\":\"alice\"}','{}','{}','{}')");
      db.run("INSERT INTO sources (id,user_id,name,provider,url,username) VALUES ('src-hf21','u-hf21','HF','huggingface','https://huggingface.co','alice')");
      db.run("INSERT INTO repositories (id,user_id,config_id,source_id,name,full_name,normalized_full_name,url,clone_url,owner,default_branch,source_provider) VALUES ('model-hf21','u-hf21','cfg-hf21','src-hf21','tiny','alice/tiny','alice/tiny','https://huggingface.co/alice/tiny','https://huggingface.co/alice/tiny.git','alice','main','huggingface')");
    },
    verify(db) {
      const config = db.query("SELECT source_config FROM configs WHERE id='cfg-hf21'").get() as { source_config: string };
      assert(JSON.parse(config.source_config).owner === "alice", "Source configuration must survive rename");
      const model = db.query("SELECT repo_type,is_gated FROM repositories WHERE id='model-hf21'").get() as { repo_type: string; is_gated: number };
      assert(model.repo_type === "model" && model.is_gated === 0, "Existing repositories must get safe HF defaults");
      for (const type of ["dataset", "space"]) {
        db.run("INSERT INTO repositories (id,user_id,config_id,source_id,name,full_name,normalized_full_name,url,clone_url,owner,default_branch,source_provider,repo_type,is_gated) VALUES (?, 'u-hf21','cfg-hf21','src-hf21','tiny','alice/tiny',?,'https://huggingface.co/alice/tiny','https://huggingface.co/alice/tiny.git','alice','main','huggingface',?,1)", [type, `${type}:alice/tiny`, type]);
      }
      assert((db.query("SELECT count(*) AS n FROM repositories").get() as { n: number }).n === 3, "All three HF types must coexist");
      assert((db.query("PRAGMA foreign_key_check").all()).length === 0, "Upgrade must preserve foreign keys");
    },
  }
};

function lintMigrations(selectedMigrations: Migration[]) {
  const violations: string[] = [];

  for (const migration of selectedMigrations) {
    for (const statement of migration.statements) {
      for (const rule of SQLITE_LINT_RULES) {
        if (rule.pattern.test(statement)) {
          violations.push(`[${migration.entry.tag}] ${rule.message}\n  Statement: ${statement.slice(0, 120)}...`);
        }
      }
    }
  }

  assert(
    violations.length === 0,
    `SQLite lint found ${violations.length} violation(s):\n\n${violations.join("\n\n")}`,
  );
}

function validateMigrations() {
  assert(latestMigration, "No migrations found in drizzle/meta/_journal.json");

  // Lint all migrations for known SQLite pitfalls before running anything.
  lintMigrations(migrations);

  const emptyDb = new Database(":memory:");
  try {
    runMigrations(emptyDb, migrations);
  } finally {
    emptyDb.close();
  }

  const upgradeFixture = latestUpgradeFixtures[latestMigration.entry.tag];
  assert(
    upgradeFixture,
    `Missing upgrade fixture for latest migration ${latestMigration.entry.tag}. Add one in scripts/validate-migrations.ts.`,
  );

  const upgradeDb = new Database(":memory:");
  try {
    runMigrations(upgradeDb, migrations.slice(0, -1));
    upgradeFixture.seed(upgradeDb);
    runMigration(upgradeDb, latestMigration);
    upgradeFixture.verify(upgradeDb);
  } finally {
    upgradeDb.close();
  }

  // Exercise the runtime repair for the issue #312 duplicate-column crash.
  validateBroken0013Repair();

  // Exercise the repair for databases that booted the reverted 1.7.0-rc.4 build.
  validateStranded0016Repair();

  console.log(
    `Validated ${migrations.length} migrations from scratch and upgrade path for ${latestMigration.entry.tag}, plus the #312 SSO-column repair and the better-auth 1.7 rc repair.`,
  );
}

try {
  validateMigrations();
} catch (error) {
  console.error("Migration validation failed:");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
