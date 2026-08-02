const SESSION_RETENTION_DAYS = 30;
const SESSION_CLEANUP_BATCH_SIZE = 100;
export const cleanupStaleSessions = async (client, now) => {
    const retentionCutoff = new Date(now.valueOf() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const staleSessions = await client.authSession.findMany({
        where: {
            OR: [{ expiresAt: { lt: retentionCutoff } }, { revokedAt: { lt: retentionCutoff } }],
        },
        select: { id: true },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: SESSION_CLEANUP_BATCH_SIZE,
    });
    if (staleSessions.length === 0)
        return 0;
    const result = await client.authSession.deleteMany({
        where: { id: { in: staleSessions.map((session) => session.id) } },
    });
    return result.count;
};
