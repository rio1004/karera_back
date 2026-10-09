# Testing Guide with Vitest

This directory contains comprehensive tests for the GameAggregator backend API using **Vitest** as the testing framework. Vitest is a fast, modern testing framework that provides excellent TypeScript support and is designed to work seamlessly with Vite projects.

## 📋 Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running Tests](#running-tests)

## 🎯 Overview

Our test suite uses Vitest for its:
- **Fast execution** - Parallel test running and smart caching
- **TypeScript support** - Native TypeScript support without additional configuration
- **Modern syntax** - Uses modern JavaScript/TypeScript features
- **Compatibility** - Jest-compatible API for easy migration
- **Watch mode** - Excellent watch mode for development

## 📁 Test Structure

```
tests/
├── usertest/ 
│   ├── register.test.ts
│   ├── login.test.ts
│   ├── password-update.test.ts
│   ├── bcrypt.test.ts
│   ├── smsService.test.ts
│   └── data files (xlsx, csv)
├── features/           # Feature-specific tests
│   └── betting/
│       ├── bet.test.ts
│       └── bet.xlsx
└── utils/             # Test utilities and helpers
    └── utils.ts
```

## 🔧 Prerequisites

Before running tests, ensure you have:

- **Node.js** (v18 or higher)
- **PostgreSQL** database running locally
- **Environment variables** properly configured
- **Database access** with appropriate permissions

## 📦 Installation

1. **Install dependencies** (if not already done):
   ```bash
   cd backend
   npm install
   ```

2. **Verify Vitest is installed**:
   ```bash
   npm list vitest
   ```

3. **Set up test database**:
   - Ensure PostgreSQL is running
   - Create a test database (tests will create their own databases as needed)
   - Configure database connection in your environment

## 🚀 Running Tests

### Basic Commands

```bash
# Run all tests
npx vitest tests

# Run Specific tests
npx vitest tests/[foldername]/filename


### Environment Variables

Ensure these environment variables are set for tests:

```bash
NODE_ENV=test
DATABASE_URL=postgresql://username:password@localhost:5432/testdb
# ... other required variables
```


---

For more information about Vitest, visit the [official documentation](https://vitest.dev/).
