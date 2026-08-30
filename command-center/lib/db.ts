import 'server-only'
import { PrismaClient } from '@prisma/client'

// Next.js dev-mode hot reload would otherwise open a new pool on every edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export { Prisma } from '@prisma/client'
