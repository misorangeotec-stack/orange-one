/**
 * Seed contacts for Phase 1 (mock data). IDs reference the default master items
 * (deterministic m1..m19 from masters.ts). One contact carries a seeded voice
 * note with a transcript (uri empty → player shows transcript, no audio file).
 */

import type { Contact } from './types';

export function seedContacts(): Contact[] {
  return [
    {
      id: 'c-akanksha',
      person: {
        name: 'Akanksha Patil',
        photoUri: null,
        mobiles: ['+91 22 6719 6718'],
        emails: ['prashant@nectormfg.web'],
        jobTitles: ['Chief Marketing Officer'],
      },
      company: {
        name: 'NECTOR SOURCE MANUFACTURER',
        logoUri: null,
        mobiles: ['+91 22 6719 6718'],
        emails: ['info@nectormfg.web'],
        websites: ['www.nectorsourcemfg.web'],
        addresses: ['69, Oasis, Nagdevi Street, Fort, Mumbai 400003'],
      },
      categoryIds: ['m5'], // Others
      interestLevelId: 'm8', // Very interested
      askedAboutIds: ['m10', 'm11'], // Product demo, Pricing
      followUpActionId: 'm17', // Book a demo
      quantityNeeded: '500 units',
      teamSize: '50-100',
      notes: [
        {
          id: 'n1',
          text: 'These are some additional notes from the stall conversation.',
          createdAt: '2026-06-23T12:08:00.000Z',
        },
      ],
      voiceNotes: [
        {
          id: 'v1',
          uri: '',
          durationMs: 13000,
          transcript:
            'Akanksha is looking for a bulk supply for their new product line. Keen on a demo next week and wants a pricing sheet for 500 units.',
          createdAt: '2026-06-23T12:08:00.000Z',
        },
      ],
      cardImages: { front: null, back: null },
      reminderPhotos: [],
      capturedAt: { address: '4QP9+VFW, Vesu, Surat, Gujarat, 395007, India' },
      capturedOn: '2026-06-23T12:08:00.000Z',
      updatedAt: '2026-06-23T12:08:00.000Z',
    },
    {
      id: 'c-robert',
      person: {
        name: 'Robert Williams',
        photoUri: null,
        mobiles: ['+91 98200 11223'],
        emails: ['robert@habsy.tech'],
        jobTitles: ['Product Manager'],
      },
      company: {
        name: 'Habsy Technologies',
        logoUri: null,
        mobiles: ['+91 98200 11223'],
        emails: ['hello@habsy.tech'],
        websites: ['www.habsy.tech'],
        addresses: ['12th Floor, WeWork, BKC, Mumbai 400051'],
      },
      categoryIds: ['m1'], // Manufacturer
      interestLevelId: 'm9', // Ready to buy
      askedAboutIds: ['m11'], // Pricing
      followUpActionId: 'm15', // Call back today
      quantityNeeded: '',
      teamSize: '10-50',
      notes: [],
      voiceNotes: [],
      cardImages: { front: null, back: null },
      reminderPhotos: [],
      capturedAt: { address: '4QP9+VFW, Vesu, Surat, Gujarat, 395007, India' },
      capturedOn: '2026-06-23T11:41:00.000Z',
      updatedAt: '2026-06-23T11:41:00.000Z',
    },
    {
      id: 'c-meera',
      person: {
        name: 'Meera Shah',
        photoUri: null,
        mobiles: ['+91 79 4004 5566'],
        emails: ['meera@shahtextiles.in'],
        jobTitles: ['Proprietor'],
      },
      company: {
        name: 'Shah Textiles',
        logoUri: null,
        mobiles: ['+91 79 4004 5566'],
        emails: ['sales@shahtextiles.in'],
        websites: ['www.shahtextiles.in'],
        addresses: ['Ring Road, Surat, Gujarat 395002'],
      },
      categoryIds: ['m3'], // Retailer
      interestLevelId: 'm7', // Slightly interested
      askedAboutIds: ['m12'], // Catalogue
      followUpActionId: 'm18', // Share catalogue
      quantityNeeded: '',
      teamSize: '<10',
      notes: [],
      voiceNotes: [],
      cardImages: { front: null, back: null },
      reminderPhotos: [],
      capturedAt: { address: 'Surat International Exhibition Centre, Gujarat' },
      capturedOn: '2026-06-22T15:20:00.000Z',
      updatedAt: '2026-06-22T15:20:00.000Z',
    },
  ];
}
