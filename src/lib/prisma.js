'use strict';

const { PrismaClient } = require('@prisma/client');

// Single shared Prisma client for the process.
const prisma = new PrismaClient();

module.exports = prisma;
