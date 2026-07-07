/**
 * Mock "AI card extraction" for Phase 1. There is no real OCR yet — after the
 * camera captures a card, this returns a plausible prefilled draft so the flow
 * feels real. In Phase 2 this is replaced by a real extraction call that takes
 * the captured image(s) and returns the same shape.
 */

import { emptyDraft, type ContactDraft } from './types';

const SAMPLES: Array<Pick<ContactDraft, 'person' | 'company'>> = [
  {
    person: { name: 'Rahul Mehta', photoUri: null, mobiles: ['+91 98765 43210'], emails: ['rahul@zenithpoly.com'], jobTitles: ['Director'] },
    company: {
      name: 'Zenith Polymers Pvt Ltd', logoUri: null,
      mobiles: ['+91 261 234 5678'], emails: ['info@zenithpoly.com'],
      websites: ['www.zenithpoly.com'], addresses: ['Plot 42, GIDC Estate, Surat, Gujarat 394210'],
    },
  },
  {
    person: { name: 'Priya Nair', photoUri: null, mobiles: ['+91 90040 12345'], emails: ['priya.nair@sunrisetex.in'], jobTitles: ['Purchase Head'] },
    company: {
      name: 'Sunrise Textiles', logoUri: null,
      mobiles: ['+91 79 4567 8900'], emails: ['purchase@sunrisetex.in'],
      websites: ['www.sunrisetex.in'], addresses: ['Ashram Road, Ahmedabad, Gujarat 380009'],
    },
  },
  {
    person: { name: 'Imran Shaikh', photoUri: null, mobiles: ['+91 88888 22221'], emails: ['imran@apexmachines.co'], jobTitles: ['Sales Manager'] },
    company: {
      name: 'Apex Machines Co.', logoUri: null,
      mobiles: ['+91 22 6600 7788'], emails: ['sales@apexmachines.co'],
      websites: ['www.apexmachines.co'], addresses: ['Andheri East, Mumbai 400069'],
    },
  },
];

/** Return a fresh draft prefilled with mock-extracted fields + the card image. */
export function mockExtractFromCard(frontUri?: string | null, backUri?: string | null): ContactDraft {
  // Vary the sample by the capture time so repeated scans differ.
  const idx = Math.floor(Date.now() / 1000) % SAMPLES.length;
  const sample = SAMPLES[idx];
  return {
    ...emptyDraft(),
    person: { ...sample.person },
    company: { ...sample.company },
    cardImages: { front: frontUri ?? null, back: backUri ?? null },
  };
}
