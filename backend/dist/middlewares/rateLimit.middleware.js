import { isIP } from 'node:net';
const IPV6_SUBNET_BITS = 56;
const INVALID_IP_KEY = 'invalid-ip';
const parseIpv4 = (value) => {
    const octets = value.split('.').map(Number);
    if (octets.length !== 4 ||
        octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return undefined;
    }
    return octets;
};
const expandIpv6 = (value) => {
    let normalized = value.toLowerCase();
    const lastColon = normalized.lastIndexOf(':');
    const ipv4Tail = lastColon >= 0 ? normalized.slice(lastColon + 1) : '';
    if (ipv4Tail.includes('.')) {
        const octets = parseIpv4(ipv4Tail);
        if (!octets)
            return undefined;
        normalized =
            normalized.slice(0, lastColon + 1) +
                `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }
    const halves = normalized.split('::');
    if (halves.length > 2)
        return undefined;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const allExplicitGroups = [...left, ...right];
    if (allExplicitGroups.some((group) => !/^[0-9a-f]{1,4}$/.test(group)))
        return undefined;
    const missingGroups = 8 - allExplicitGroups.length;
    if ((halves.length === 1 && missingGroups !== 0) || (halves.length === 2 && missingGroups < 1)) {
        return undefined;
    }
    return [
        ...left.map((group) => Number.parseInt(group, 16)),
        ...Array.from({ length: missingGroups }, () => 0),
        ...right.map((group) => Number.parseInt(group, 16)),
    ];
};
export const normalizeRateLimitIp = (ip) => {
    if (!ip || isIP(ip) === 0)
        return INVALID_IP_KEY;
    if (isIP(ip) === 4)
        return ip;
    const groups = expandIpv6(ip);
    if (!groups || groups.length !== 8)
        return INVALID_IP_KEY;
    const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
    if (isIpv4Mapped) {
        return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    }
    groups[3] &= 0xff00;
    groups.fill(0, 4);
    return `${groups.map((group) => group.toString(16).padStart(4, '0')).join(':')}/${IPV6_SUBNET_BITS}`;
};
export const rateLimitKeyGenerator = (req) => normalizeRateLimitIp(req.ip);
export const createRateLimitHandler = (message) => (req, res, _next, options) => {
    res.set('Cache-Control', 'no-store');
    res.status(options.statusCode).json({
        success: false,
        status: 'error',
        statusCode: options.statusCode,
        message,
        correlationId: req.correlationId,
    });
};
