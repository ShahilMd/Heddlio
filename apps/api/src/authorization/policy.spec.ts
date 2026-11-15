import {
  DEFAULT_ROLE_SLUG,
  OWNER_ROLE_SLUG,
  PERMISSIONS,
  PERMISSION_BY_KEY,
  PERMISSION_KEYS,
  SYSTEM_ROLE_TEMPLATES,
  checkCanAssignRole,
  checkCanCreateRole,
  checkCanGrantPermissions,
  checkCanManageMember,
  checkCanManageRole,
  generateInviteToken,
  hashInviteToken,
  inviteTokenDigestEquals,
  isPermissionKey,
  normalizeEmail,
  permissionKeysForTemplate,
  resolveEffectivePermissions,
  type ActorPolicyContext,
  type PermissionKey,
  type RoleTemplate,
} from '@heddlio/auth';

/**
 * These are the security invariants of the authorization model, tested without
 * Nest, Postgres or HTTP. If one of these changes, the API's behaviour changes
 * for every organization, so keep the assertions explicit.
 */

const permission = (key: PermissionKey): PermissionKey => key;

const actor = (
  overrides: Partial<ActorPolicyContext> = {},
): ActorPolicyContext => ({
  userId: 'actor-user',
  rank: 300,
  isOwner: false,
  permissions: new Set<PermissionKey>(['org.view']),
  ...overrides,
});

const role = (
  overrides: Partial<{
    id: string;
    rank: number;
    isOwner: boolean;
    permissionKeys: readonly string[];
  }> = {},
) => ({
  id: 'role-id',
  rank: 100,
  isOwner: false,
  permissionKeys: [] as readonly string[],
  ...overrides,
});

describe('permission catalog', () => {
  it('has unique, well-formed keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSIONS.length);
    for (const definition of PERMISSIONS) {
      // Keys are `<resource>.<action>`; a few actions are qualified further
      // (`member.role.assign`), so only the resource prefix is fixed.
      expect(definition.key.startsWith(`${definition.resource}.`)).toBe(true);
      expect(definition.action.length).toBeGreaterThan(0);
      expect(isPermissionKey(definition.key)).toBe(true);
      expect(PERMISSION_BY_KEY.get(definition.key)).toBe(definition);
    }
  });

  it('keeps destructive ownership operations unassignable', () => {
    expect(PERMISSION_BY_KEY.get('org.delete')?.assignable).toBe(false);
    expect(PERMISSION_BY_KEY.get('org.transfer_ownership')?.assignable).toBe(
      false,
    );
    // Everything else may be delegated.
    for (const definition of PERMISSIONS) {
      if (
        definition.key !== 'org.delete' &&
        definition.key !== 'org.transfer_ownership'
      ) {
        expect(definition.assignable).toBe(true);
      }
    }
  });

  it('rejects unknown permission keys', () => {
    expect(isPermissionKey('org.nope')).toBe(false);
    expect(isPermissionKey('')).toBe(false);
  });
});

describe('role templates', () => {
  const templates: readonly RoleTemplate[] = SYSTEM_ROLE_TEMPLATES;

  it('has unique slugs and ranks and exactly one owner and one default', () => {
    expect(new Set(templates.map((template) => template.slug)).size).toBe(
      templates.length,
    );
    expect(new Set(templates.map((template) => template.rank)).size).toBe(
      templates.length,
    );
    expect(templates.filter((template) => template.isOwner)).toHaveLength(1);
    expect(templates.filter((template) => template.isDefault)).toHaveLength(1);
    expect(templates.filter((template) => template.isSystem)).toHaveLength(1);
    expect(DEFAULT_ROLE_SLUG).toBe('member');
    expect(OWNER_ROLE_SLUG).toBe('owner');
  });

  it('only contains known, grantable permissions outside the owner role', () => {
    for (const template of templates) {
      const keys = permissionKeysForTemplate(template);
      for (const key of keys) {
        expect(isPermissionKey(key)).toBe(true);
      }
      if (!template.isOwner) {
        for (const key of keys) {
          expect(PERMISSION_BY_KEY.get(key)?.assignable).toBe(true);
        }
      }
    }
  });

  it('gives the owner every key and reserves ownership operations', () => {
    const owner = templates.find((template) => template.isOwner);
    expect(owner).toBeDefined();
    expect(permissionKeysForTemplate(owner!)).toEqual(PERMISSION_KEYS);

    for (const template of templates) {
      if (template.isOwner) continue;
      expect(permissionKeysForTemplate(template)).not.toContain('org.delete');
      expect(permissionKeysForTemplate(template)).not.toContain(
        'org.transfer_ownership',
      );
    }
  });

  it('keeps rank ordering consistent with delegated authority', () => {
    const bySlug = new Map(templates.map((template) => [template.slug, template]));
    expect(bySlug.get('owner')!.rank).toBeGreaterThan(bySlug.get('admin')!.rank);
    expect(bySlug.get('admin')!.rank).toBeGreaterThan(
      bySlug.get('manager')!.rank,
    );
    expect(bySlug.get('manager')!.rank).toBeGreaterThan(
      bySlug.get('developer')!.rank,
    );
    expect(bySlug.get('developer')!.rank).toBeGreaterThan(
      bySlug.get('member')!.rank,
    );
    expect(bySlug.get('member')!.rank).toBeGreaterThan(
      bySlug.get('guest')!.rank,
    );

    // A parent role must hold every permission its child template holds, so a
    // lower-ranked role can never exceed the authority of the role above it.
    const parentOf = ['admin', 'manager', 'developer', 'member'];
    for (const slug of parentOf) {
      const index = templates.findIndex((template) => template.slug === slug);
      const parent = templates[index - 1];
      const child = templates[index];
      const parentKeys = new Set(permissionKeysForTemplate(parent));
      for (const key of permissionKeysForTemplate(child)) {
        expect(parentKeys.has(key)).toBe(true);
      }
    }
  });

  it('does not grant duplicate permissions within one template', () => {
    for (const template of templates) {
      const keys = permissionKeysForTemplate(template);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('resolveEffectivePermissions', () => {
  it('returns every key for the owner role regardless of grants', () => {
    const result = resolveEffectivePermissions({
      role: role({ isOwner: true, permissionKeys: [] }),
    });
    expect(result.size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) {
      expect(result.has(key)).toBe(true);
    }
  });

  it('returns the role grants as the base set', () => {
    const result = resolveEffectivePermissions({
      role: role({
        permissionKeys: [permission('org.view'), permission('member.view')],
      }),
    });
    expect([...result].sort()).toEqual(['member.view', 'org.view']);
  });

  it('adds allow overrides and removes deny overrides', () => {
    const result = resolveEffectivePermissions({
      role: role({ permissionKeys: [permission('org.view')] }),
      overrides: [
        { permissionKey: 'member.view', effect: 'allow' },
        { permissionKey: 'org.view', effect: 'deny' },
      ],
    });
    expect(result.has('member.view')).toBe(true);
    expect(result.has('org.view')).toBe(false);
  });

  it('ignores expired overrides but keeps them in storage', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const result = resolveEffectivePermissions({
      role: role({ permissionKeys: [permission('org.view')] }),
      now,
      overrides: [
        {
          permissionKey: 'member.view',
          effect: 'allow',
          expiresAt: new Date('2025-12-31T23:59:59Z'),
        },
        {
          permissionKey: 'org.view',
          effect: 'deny',
          expiresAt: '2025-12-31T23:59:59Z',
        },
        {
          permissionKey: 'role.view',
          effect: 'allow',
          expiresAt: '2026-01-01T00:00:01Z',
        },
      ],
    });
    expect(result.has('member.view')).toBe(false);
    expect(result.has('org.view')).toBe(true);
    expect(result.has('role.view')).toBe(true);
  });

  it('treats a null or missing expiry as permanent', () => {
    const result = resolveEffectivePermissions({
      role: role(),
      overrides: [
        { permissionKey: 'issue.view', effect: 'allow', expiresAt: null },
        { permissionKey: 'issue.create', effect: 'allow' },
      ],
    });
    expect(result.has('issue.view')).toBe(true);
    expect(result.has('issue.create')).toBe(true);
  });

  it('ignores unknown keys and invalid dates instead of throwing', () => {
    const result = resolveEffectivePermissions({
      role: role({ permissionKeys: ['not.a.real.key', 'org.view'] }),
      overrides: [
        { permissionKey: 'also.not.real', effect: 'allow' },
        {
          permissionKey: 'org.view',
          effect: 'deny',
          expiresAt: 'not-a-date',
        },
      ],
    });
    expect([...result]).toEqual(['org.view']);
  });

  it('applies denies after allows, independent of input order', () => {
    const overrides = [
      { permissionKey: 'org.view', effect: 'deny' as const },
      { permissionKey: 'org.view', effect: 'allow' as const },
    ];
    const forward = resolveEffectivePermissions({
      role: role({ permissionKeys: [permission('org.view')] }),
      overrides,
    });
    const reversed = resolveEffectivePermissions({
      role: role({ permissionKeys: [permission('org.view')] }),
      overrides: [...overrides].reverse(),
    });
    expect(forward.has('org.view')).toBe(false);
    expect(reversed.has('org.view')).toBe(false);
  });
});

describe('checkCanManageRole', () => {
  it('rejects editing the owner role even for the owner', () => {
    const result = checkCanManageRole(actor({ isOwner: true }), role({ isOwner: true }));
    expect(result).toEqual({
      ok: false,
      code: 'OWNER_ROLE_IMMUTABLE',
      message: expect.any(String),
    });
  });

  it('lets the owner manage any non-owner role', () => {
    const result = checkCanManageRole(
      actor({ isOwner: true, rank: 1000 }),
      role({ rank: 900 }),
    );
    expect(result.ok).toBe(true);
  });

  it('requires a strictly lower rank for non-owners', () => {
    expect(checkCanManageRole(actor({ rank: 700 }), role({ rank: 500 })).ok).toBe(
      true,
    );
    expect(checkCanManageRole(actor({ rank: 700 }), role({ rank: 700 }))).toEqual(
      {
        ok: false,
        code: 'ROLE_RANK_TOO_LOW',
        message: expect.any(String),
      },
    );
    expect(checkCanManageRole(actor({ rank: 700 }), role({ rank: 900 })).ok).toBe(
      false,
    );
  });
});

describe('checkCanCreateRole', () => {
  it('rejects peers and superiors for non-owners', () => {
    expect(
      checkCanCreateRole(actor({ rank: 700 }), { rank: 700, permissionKeys: [] })
        .ok,
    ).toBe(false);
    expect(
      checkCanCreateRole(actor({ rank: 700 }), { rank: 500, permissionKeys: [] })
        .ok,
    ).toBe(true);
  });

  it('lets the owner create a role at any rank', () => {
    const result = checkCanCreateRole(
      actor({
        isOwner: true,
        rank: 1000,
        permissions: new Set(PERMISSION_KEYS),
      }),
      { rank: 1000, permissionKeys: ['member.view'] },
    );
    expect(result.ok).toBe(true);
  });

  it('applies the grant check to the new role permissions', () => {
    const result = checkCanCreateRole(
      actor({ rank: 900, permissions: new Set<PermissionKey>(['org.view']) }),
      { rank: 500, permissionKeys: ['member.view'] },
    );
    expect(result).toEqual({
      ok: false,
      code: 'PERMISSION_ESCALATION',
      message: expect.any(String),
    });
  });
});

describe('checkCanGrantPermissions', () => {
  it('rejects unknown permissions', () => {
    expect(
      checkCanGrantPermissions(actor({ isOwner: true }), ['not.real']),
    ).toEqual({
      ok: false,
      code: 'UNKNOWN_PERMISSION',
      message: expect.any(String),
    });
  });

  it('never allows ownership operations to be granted', () => {
    const owner = actor({
      isOwner: true,
      permissions: new Set(PERMISSION_KEYS),
    });
    for (const key of ['org.delete', 'org.transfer_ownership']) {
      expect(checkCanGrantPermissions(owner, [key])).toEqual({
        ok: false,
        code: 'PERMISSION_NOT_ASSIGNABLE',
        message: expect.any(String),
      });
    }
  });

  it('requires non-owners to already hold every granted permission', () => {
    expect(
      checkCanGrantPermissions(
        actor({ permissions: new Set<PermissionKey>(['org.view']) }),
        ['org.view'],
      ).ok,
    ).toBe(true);
    expect(
      checkCanGrantPermissions(
        actor({ permissions: new Set<PermissionKey>(['org.view']) }),
        ['org.view', 'member.remove'],
      ),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_ESCALATION',
      message: expect.any(String),
    });
  });

  it('lets the owner grant any assignable permission', () => {
    expect(
      checkCanGrantPermissions(
        actor({ isOwner: true, permissions: new Set<PermissionKey>() }),
        ['member.remove', 'role.manage'],
      ).ok,
    ).toBe(true);
  });
});

describe('checkCanAssignRole', () => {
  it('never assigns the owner role', () => {
    expect(
      checkCanAssignRole(
        actor({ isOwner: true, rank: 1000 }),
        role({ isOwner: true, rank: 1000 }),
      ),
    ).toEqual({
      ok: false,
      code: 'OWNER_ROLE_NOT_ASSIGNABLE',
      message: expect.any(String),
    });
  });

  it('lets the owner assign any non-owner role', () => {
    expect(
      checkCanAssignRole(
        actor({ isOwner: true, rank: 1000 }),
        role({ rank: 900, permissionKeys: ['org.delete'] }),
      ).ok,
    ).toBe(true);
  });

  it('requires a lower rank and a permission subset', () => {
    const manager = actor({
      rank: 700,
      permissions: new Set<PermissionKey>(['org.view', 'member.view']),
    });

    expect(
      checkCanAssignRole(manager, role({ rank: 500, permissionKeys: ['org.view'] }))
        .ok,
    ).toBe(true);

    expect(
      checkCanAssignRole(manager, role({ rank: 700, permissionKeys: ['org.view'] })),
    ).toEqual({
      ok: false,
      code: 'ROLE_RANK_TOO_LOW',
      message: expect.any(String),
    });

    // A low-ranked role can still be over-powered: the subset rule catches it.
    expect(
      checkCanAssignRole(
        manager,
        role({ rank: 100, permissionKeys: ['org.view', 'member.remove'] }),
      ),
    ).toEqual({
      ok: false,
      code: 'PERMISSION_ESCALATION',
      message: expect.any(String),
    });
  });
});

describe('checkCanManageMember', () => {
  it('forbids self-modification, including for the owner', () => {
    const owner = actor({ isOwner: true, userId: 'same', rank: 1000 });
    expect(
      checkCanManageMember(owner, {
        userId: 'same',
        role: { rank: 100, isOwner: false },
      }),
    ).toEqual({
      ok: false,
      code: 'SELF_MODIFICATION_NOT_ALLOWED',
      message: expect.any(String),
    });
  });

  it('protects the owner member from everyone else', () => {
    expect(
      checkCanManageMember(actor({ isOwner: true, userId: 'other' }), {
        userId: 'owner-user',
        role: { rank: 1000, isOwner: true },
      }),
    ).toEqual({
      ok: false,
      code: 'MEMBER_IMMUTABLE',
      message: expect.any(String),
    });
  });

  it('lets the owner manage any non-owner member', () => {
    expect(
      checkCanManageMember(actor({ isOwner: true }), {
        userId: 'other',
        role: { rank: 900, isOwner: false },
      }).ok,
    ).toBe(true);
  });

  it('requires a strictly higher rank for non-owners', () => {
    expect(
      checkCanManageMember(actor({ rank: 700 }), {
        userId: 'other',
        role: { rank: 500, isOwner: false },
      }).ok,
    ).toBe(true);
    expect(
      checkCanManageMember(actor({ rank: 700 }), {
        userId: 'other',
        role: { rank: 700, isOwner: false },
      }),
    ).toEqual({
      ok: false,
      code: 'ROLE_RANK_TOO_LOW',
      message: expect.any(String),
    });
  });
});

describe('invitation tokens', () => {
  it('generates high-entropy, URL-safe tokens', () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateInviteToken()).not.toBe(token);
  });

  it('hashes deterministically to a 64-character hex digest', () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInviteToken(token)).toBe(hash);
    expect(hashInviteToken(`${token}x`)).not.toBe(hash);
  });

  it('compares digests safely', () => {
    const hash = hashInviteToken('token');
    expect(inviteTokenDigestEquals(hash, hash)).toBe(true);
    expect(inviteTokenDigestEquals(hash, hashInviteToken('other'))).toBe(false);
    expect(inviteTokenDigestEquals(hash, 'short')).toBe(false);
  });

  it('normalizes emails to a single canonical form', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });
});
