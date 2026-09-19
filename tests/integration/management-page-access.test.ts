import { describe, expect, test, vi } from 'vitest';
import { requireManagementPage } from '@/lib/auth/page-access';
import { setMockSession } from '@/tests/helpers/auth';
import { createMember, createOrganisationAccount, createOrganisationStaff } from '@/tests/helpers/test-data';
import { prisma } from '@/lib/db';

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error('NOT_FOUND'); }
}));

describe('management page access', () => {
  test('anonymous page requests redirect to login with callback', async () => {
    await expect(requireManagementPage('events:manage', '/dashboard/events')).rejects.toThrow('REDIRECT:/login?callbackUrl=%2Fdashboard%2Fevents');
  });
  test('joined member roles do not grant management', async () => {
    const {organisation} = await createOrganisationAccount();
    const member = await createMember();
    await prisma.organisationMember.create({data: {userId: member.id, organisationId: organisation.id, role: 'org_owner'}});
    setMockSession({userId: member.id, email: member.email, accountRole: 'member'});
    await expect(requireManagementPage('events:manage', '/dashboard/events')).rejects.toThrow('NOT_FOUND');
  });
  test('active member staff allowed only appropriate pages and revocation is immediate', async () => {
    const {organisation} = await createOrganisationAccount();
    const member = await createMember();
    const staff = await createOrganisationStaff({organisationId: organisation.id, userId: member.id});
    setMockSession({userId: member.id, email: member.email, accountRole: 'member'});
    expect((await requireManagementPage('events:manage', '/dashboard/events')).id).toBe(organisation.id);
    await expect(requireManagementPage('orders:read', '/dashboard/orders')).rejects.toThrow('NOT_FOUND');
    await prisma.organisationStaff.update({where: {id: staff.id}, data: {status: 'revoked'}});
    await expect(requireManagementPage('events:manage', '/dashboard/events')).rejects.toThrow('NOT_FOUND');
  });
  test('database errors remain errors rather than access-denied pages', async () => {
    const member = await createMember();
    setMockSession({userId: member.id, email: member.email, accountRole: 'member'});
    vi.spyOn(prisma.organisationStaff, 'findFirst').mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(requireManagementPage('events:manage', '/dashboard/events')).rejects.toThrow('Database unavailable');
  });
});
