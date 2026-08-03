import type { DeliveryStatus, MessageStatus, StaffSpecialty } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { hashPassword } from '../utils/crypto.js';
import {
  addCalendarDays,
  atIstanbulTime,
  createWeddingRange,
  getIstanbulDate,
} from '../utils/domain.js';

const DEMO_PASSWORD = 'Demo-Musteri-2026!';

const staffRows: Array<{
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  specialties: StaffSpecialty[];
}> = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    firstName: 'Ahmet',
    lastName: 'Yalçın',
    phone: '+905550000101',
    specialties: ['PHOTOGRAPHY', 'VIDEO'],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    firstName: 'Selin',
    lastName: 'Aksoy',
    phone: '+905550000102',
    specialties: ['PHOTOGRAPHY'],
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    firstName: 'Mert',
    lastName: 'Kaya',
    phone: '+905550000103',
    specialties: ['VIDEO', 'EDITING'],
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    firstName: 'Derya',
    lastName: 'Şahin',
    phone: '+905550000104',
    specialties: ['DRONE', 'PHOTOGRAPHY'],
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    firstName: 'Burak',
    lastName: 'Demir',
    phone: '+905550000105',
    specialties: ['JIMMY_JIB', 'ASSISTANT'],
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    firstName: 'Ece',
    lastName: 'Arslan',
    phone: '+905550000106',
    specialties: ['ASSISTANT', 'ALBUM'],
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    firstName: 'Onur',
    lastName: 'Çelik',
    phone: '+905550000107',
    specialties: ['VIDEO', 'DRONE'],
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    firstName: 'İrem',
    lastName: 'Koç',
    phone: '+905550000108',
    specialties: ['EDITING', 'ALBUM'],
  },
  {
    id: '10000000-0000-4000-8000-000000000009',
    firstName: 'Kerem',
    lastName: 'Aydın',
    phone: '+905550000109',
    specialties: ['PHOTOGRAPHY', 'ASSISTANT'],
  },
  {
    id: '10000000-0000-4000-8000-000000000010',
    firstName: 'Nazlı',
    lastName: 'Öztürk',
    phone: '+905550000110',
    specialties: ['VIDEO', 'ASSISTANT'],
  },
];

const demoWeddings = [
  {
    bride: ['Zeynep', 'Acar'],
    groom: ['Emir', 'Bulut'],
    venueSlug: 'cess-wedding',
    dayOffset: 0,
    startTime: '18:00',
    endTime: '23:30',
    endsNextDay: false,
    deliveryStatus: 'MONTAJ' as DeliveryStatus,
  },
  {
    bride: ['Elif', 'Yılmaz'],
    groom: ['Can', 'Demir'],
    venueSlug: 'bella-garden',
    dayOffset: 0,
    startTime: '19:00',
    endTime: '01:00',
    endsNextDay: true,
    deliveryStatus: 'HAZIRLANIYOR' as DeliveryStatus,
  },
  {
    bride: ['İrem', 'Kaya'],
    groom: ['Bora', 'Şen'],
    venueSlug: 'cess-wedding',
    dayOffset: 1,
    startTime: '17:30',
    endTime: '23:00',
    endsNextDay: false,
    deliveryStatus: 'KONTROL' as DeliveryStatus,
  },
  {
    bride: ['Melis', 'Arslan'],
    groom: ['Ege', 'Koç'],
    venueSlug: 'talia-garden',
    dayOffset: 3,
    startTime: '19:00',
    endTime: '02:00',
    endsNextDay: true,
    deliveryStatus: 'TESLIME_HAZIR' as DeliveryStatus,
  },
  {
    bride: ['Ceren', 'Akın'],
    groom: ['Mert', 'Uçar'],
    venueSlug: 'green-house-garden',
    dayOffset: 8,
    startTime: '18:30',
    endTime: '00:30',
    endsNextDay: true,
    deliveryStatus: 'MONTAJ' as DeliveryStatus,
  },
  {
    bride: ['Aslı', 'Eren'],
    groom: ['Kaan', 'Tekin'],
    venueSlug: 'mafsel-omerli',
    dayOffset: 14,
    startTime: '18:00',
    endTime: '23:30',
    endsNextDay: false,
    deliveryStatus: 'HAZIRLANIYOR' as DeliveryStatus,
  },
] as const;

const pendingApplications = [
  {
    bride: ['Yağmur', 'Işık'],
    groom: ['Arda', 'Güneş'],
    venueSlug: 'yesil-nesil-garden',
    dayOffset: 5,
  },
  { bride: ['Sude', 'Çetin'], groom: ['Barış', 'Kurt'], venueSlug: 'rena-garden', dayOffset: 11 },
  {
    bride: ['Pelin', 'Yıldız'],
    groom: ['Deniz', 'Acar'],
    venueSlug: 'bella-garden',
    dayOffset: 18,
  },
] as const;

const applicationData = (
  index: number,
  couple: {
    bride: readonly [string, string];
    groom: readonly [string, string];
    venueId: string;
    date: string;
  },
  packageRecord: { id: string; code: string; name: string; priceCents: number },
  startsAt: Date,
  endsAt: Date,
) => ({
  id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  referenceCode: `DEMO-${String(index).padStart(3, '0')}`,
  source: 'ADMIN' as const,
  brideFirstName: couple.bride[0],
  brideLastName: couple.bride[1],
  bridePhone: `+90555100${String(index).padStart(4, '0')}`,
  groomFirstName: couple.groom[0],
  groomLastName: couple.groom[1],
  groomPhone: `+90555200${String(index).padStart(4, '0')}`,
  primaryContact: 'GELIN' as const,
  primaryEmail: `demo-cift-${index}@example.invalid`,
  weddingStartsAt: startsAt,
  weddingEndsAt: endsAt,
  venueId: couple.venueId,
  packageId: packageRecord.id,
  packageCodeSnapshot: packageRecord.code,
  packageNameSnapshot: packageRecord.name,
  packagePriceCents: packageRecord.priceCents,
  totalPriceCents: packageRecord.priceCents,
  paymentMethod: 'CASH' as const,
  payableNowCents: packageRecord.priceCents,
  note: 'Demo yönetim paneli verisi',
});

const main = async () => {
  const today = getIstanbulDate(new Date());
  const [admin, packageRecord, venues] = await Promise.all([
    prisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.package.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.venue.findMany(),
  ]);
  if (!admin) throw new Error('Demo seed için aktif bir ADMIN kullanıcısı gerekli.');
  if (!packageRecord)
    throw new Error('Demo seed için aktif bir paket gerekli. Önce npm run seed çalıştırın.');
  const venueBySlug = new Map(venues.map((venue) => [venue.slug, venue]));
  const requiredVenue = (slug: string) => {
    const venue = venueBySlug.get(slug);
    if (!venue) throw new Error(`Demo seed için salon bulunamadı: ${slug}`);
    return venue;
  };

  for (const staff of staffRows) {
    await prisma.staff.upsert({
      where: { id: staff.id },
      create: staff,
      update: { ...staff, isActive: true },
    });
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const weddingIds: string[] = [];
  for (const [offset, row] of demoWeddings.entries()) {
    const index = offset + 1;
    const weddingDate = addCalendarDays(today, row.dayOffset);
    const venue = requiredVenue(row.venueSlug);
    const { startsAt, endsAt } = createWeddingRange(
      weddingDate,
      row.startTime,
      row.endTime,
      row.endsNextDay,
    );
    const application = applicationData(
      index,
      { bride: row.bride, groom: row.groom, venueId: venue.id, date: weddingDate },
      packageRecord,
      startsAt,
      endsAt,
    );
    await prisma.bookingApplication.upsert({
      where: { id: application.id },
      create: {
        ...application,
        status: 'ONAYLANDI',
        reviewedAt: new Date(),
        reviewedById: admin.id,
      },
      update: {
        ...application,
        status: 'ONAYLANDI',
        reviewedAt: new Date(),
        reviewedById: admin.id,
        rejectionReason: null,
      },
    });

    const userId = `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        username: `demo-musteri-${String(index).padStart(2, '0')}`,
        passwordHash,
        role: 'MUSTERI',
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        passwordChangedAt: new Date(),
      },
    });

    const weddingId = `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    weddingIds.push(weddingId);
    await prisma.wedding.upsert({
      where: { id: weddingId },
      create: {
        id: weddingId,
        applicationId: application.id,
        customerUserId: userId,
        brideFirstName: row.bride[0],
        brideLastName: row.bride[1],
        bridePhone: application.bridePhone,
        groomFirstName: row.groom[0],
        groomLastName: row.groom[1],
        groomPhone: application.groomPhone,
        primaryContact: 'GELIN',
        primaryEmail: application.primaryEmail,
        startsAt,
        endsAt,
        venueId: venue.id,
        packageSummary: {
          code: packageRecord.code,
          name: packageRecord.name,
          packagePriceCents: packageRecord.priceCents,
          totalPriceCents: packageRecord.priceCents,
          services: [],
        },
        note: 'Demo düğün kaydı',
      },
      update: {
        brideFirstName: row.bride[0],
        brideLastName: row.bride[1],
        bridePhone: application.bridePhone,
        groomFirstName: row.groom[0],
        groomLastName: row.groom[1],
        groomPhone: application.groomPhone,
        startsAt,
        endsAt,
        venueId: venue.id,
        cancelledAt: null,
      },
    });

    const deliveryId = `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const dueDate = new Date(`${addCalendarDays(weddingDate, 21)}T00:00:00.000Z`);
    await prisma.delivery.upsert({
      where: { weddingId },
      create: { id: deliveryId, weddingId, status: row.deliveryStatus, dueDate },
      update: { status: row.deliveryStatus, dueDate, releasedAt: null },
    });
    await prisma.deliveryStatusHistory.upsert({
      where: { id: `60000000-0000-4000-8000-${String(index).padStart(12, '0')}` },
      create: {
        id: `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        deliveryId,
        toStatus: row.deliveryStatus,
        actorUserId: admin.id,
      },
      update: { toStatus: row.deliveryStatus },
    });

    const messageStatus: MessageStatus = index % 2 === 0 ? 'SENT' : 'PENDING';
    const dueAt = atIstanbulTime(addCalendarDays(weddingDate, 2), '10:00');
    await prisma.messageTask.upsert({
      where: { weddingId_kind: { weddingId, kind: 'PREPARATION_UPDATE' } },
      create: {
        weddingId,
        kind: 'PREPARATION_UPDATE',
        status: messageStatus,
        dueAt,
        recipientPhone: application.bridePhone,
        sentAt: messageStatus === 'SENT' ? dueAt : null,
        sentById: messageStatus === 'SENT' ? admin.id : null,
      },
      update: {
        status: messageStatus,
        dueAt,
        recipientPhone: application.bridePhone,
        sentAt: messageStatus === 'SENT' ? dueAt : null,
        sentById: messageStatus === 'SENT' ? admin.id : null,
      },
    });
  }

  for (const [offset, row] of pendingApplications.entries()) {
    const index = demoWeddings.length + offset + 1;
    const date = addCalendarDays(today, row.dayOffset);
    const venue = requiredVenue(row.venueSlug);
    const { startsAt, endsAt } = createWeddingRange(date, '18:00', '23:30', false);
    const application = applicationData(
      index,
      { bride: row.bride, groom: row.groom, venueId: venue.id, date },
      packageRecord,
      startsAt,
      endsAt,
    );
    await prisma.bookingApplication.upsert({
      where: { id: application.id },
      create: { ...application, status: 'ONAY_BEKLIYOR' },
      update: {
        ...application,
        status: 'ONAY_BEKLIYOR',
        reviewedAt: null,
        reviewedById: null,
        rejectionReason: null,
      },
    });
  }

  const rejectedIndex = 10;
  const rejectedDate = addCalendarDays(today, 7);
  const rejectedVenue = requiredVenue('rena-garden');
  const rejectedRange = createWeddingRange(rejectedDate, '19:00', '23:30', false);
  const rejected = applicationData(
    rejectedIndex,
    {
      bride: ['Nisa', 'Er'],
      groom: ['Ozan', 'Çakır'],
      venueId: rejectedVenue.id,
      date: rejectedDate,
    },
    packageRecord,
    rejectedRange.startsAt,
    rejectedRange.endsAt,
  );
  await prisma.bookingApplication.upsert({
    where: { id: rejected.id },
    create: {
      ...rejected,
      status: 'REDDEDILDI',
      reviewedAt: new Date(),
      reviewedById: admin.id,
      rejectionReason: 'Demo: tarih uygun değil',
    },
    update: {
      ...rejected,
      status: 'REDDEDILDI',
      reviewedAt: new Date(),
      reviewedById: admin.id,
      rejectionReason: 'Demo: tarih uygun değil',
    },
  });

  const assignmentRows: Array<[number, number, StaffSpecialty]> = [
    [1, 1, 'PHOTOGRAPHY'],
    [1, 3, 'VIDEO'],
    [1, 4, 'DRONE'],
    [1, 6, 'ASSISTANT'],
    [2, 2, 'PHOTOGRAPHY'],
    [2, 7, 'VIDEO'],
    [2, 4, 'DRONE'],
    [2, 5, 'JIMMY_JIB'],
    [3, 1, 'VIDEO'],
    [3, 9, 'PHOTOGRAPHY'],
    [3, 6, 'ASSISTANT'],
    [4, 2, 'PHOTOGRAPHY'],
    [4, 3, 'VIDEO'],
    [4, 5, 'JIMMY_JIB'],
    [5, 9, 'PHOTOGRAPHY'],
    [5, 10, 'VIDEO'],
    [5, 7, 'DRONE'],
    [6, 1, 'PHOTOGRAPHY'],
    [6, 3, 'EDITING'],
    [6, 6, 'ALBUM'],
  ];
  for (const [weddingNumber, staffNumber, specialty] of assignmentRows) {
    const weddingId = weddingIds[weddingNumber - 1]!;
    const staffId = staffRows[staffNumber - 1]!.id;
    await prisma.weddingAssignment.upsert({
      where: { weddingId_staffId: { weddingId, staffId } },
      create: { weddingId, staffId, specialty },
      update: { specialty },
    });
  }

  const [weddingCount, applicationCount, staffCount, assignmentCount] = await Promise.all([
    prisma.wedding.count({ where: { id: { in: weddingIds } } }),
    prisma.bookingApplication.count({ where: { referenceCode: { startsWith: 'DEMO-' } } }),
    prisma.staff.count({ where: { id: { in: staffRows.map((staff) => staff.id) } } }),
    prisma.weddingAssignment.count({ where: { weddingId: { in: weddingIds } } }),
  ]);

  console.log(
    `Demo verileri hazır: ${weddingCount} düğün, ${applicationCount} başvuru, ${staffCount} personel ve ${assignmentCount} atama.`,
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
