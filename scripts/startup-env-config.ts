#!/usr/bin/env bun
/**
 * Startup environment configuration script
 * This script loads configuration from environment variables before the application starts
 * It ensures that Docker environment variables are properly populated in the database
 *
 * Usage:
 *   bun scripts/startup-env-config.ts
 */

import { initializeConfigFromEnv } from "../src/lib/env-config-loader";

async function runEnvConfigInitialization() {
  console.log('=== HF-mirror Environment Configuration ===');
  console.log('Loading configuration from environment variables...');
  console.log('');

  const startTime = Date.now();

  try {
    await initializeConfigFromEnv();

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`✅ Environment configuration loaded successfully in ${duration}ms`);
    process.exit(0);
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    console.error(`❌ Failed to load environment configuration after ${duration}ms:`, error);
    console.error('Application will start anyway, but environment configuration was not loaded.');

    // Exit with error code but allow startup to continue
    process.exit(1);
  }
}

// Handle process signals gracefully
process.on('SIGINT', () => {
  console.log('\n⚠️  Configuration loading interrupted by SIGINT');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Configuration loading interrupted by SIGTERM');
  process.exit(143);
});

// Run the environment configuration initialization
runEnvConfigInitialization();
