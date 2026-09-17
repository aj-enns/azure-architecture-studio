# Manage user access

The Azure deployment uses Microsoft Entra authentication with **Assignment
required?** set to **Yes**. Access depends on three separate controls:

1. Create or invite the person's identity in the application's Entra tenant.
2. Grant tenant-wide admin consent for the expected sign-in scopes once for the
   Enterprise Application.
3. Add that identity to a security group assigned to the
   `Azure Architecture Studio - Web` **Enterprise application**. A direct user
   assignment is also supported when group assignment is unavailable.

Adding someone to the tenant is necessary but is not enough by itself. If step 3
is missing, Entra returns `AADSTS50105` even though the user or guest exists.
Users do not need an Azure subscription or Azure resource RBAC roles to use the
application.

## Prerequisites

Perform these steps in the same Entra tenant configured by `AZURE_TENANT_ID`.
You need permission to manage assignments for the Enterprise Application, such
as **Cloud Application Administrator**, **Application Administrator**, **User
Administrator**, or ownership of its service principal.

Group-based application assignment requires Microsoft Entra ID P1 or P2. If
that licensing is unavailable, use the direct-assignment procedure below.

## One-time tenant admin consent

Before any non-administrator signs in, an administrator must grant tenant-wide
consent for the low-privilege sign-in scopes used by Easy Auth: `openid`,
`profile`, `email`, and `User.Read` when the App Registration declares it. This
is required because users cannot grant their own consent when **Assignment
required?** is **Yes**.

The recommended [setup script](../infra/setup.ps1) creates and verifies this
consent grant automatically. It stops instead of granting consent if a reused
App Registration contains permissions outside the known sign-in scope set.

For a manual installation:

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com)
   with an account authorized to grant tenant-wide consent.
2. Open **Entra ID > Enterprise apps > All applications > Azure Architecture
   Review - Web**.
3. Open **Security > Permissions**.
4. Select **Grant admin consent for &lt;tenant&gt;**, review the requested
   permissions, and accept only the expected sign-in permissions.
5. Confirm that the permissions page shows consent granted for the tenant.

See Microsoft's
[Grant tenant-wide admin consent to an application](https://learn.microsoft.com/entra/identity/enterprise-apps/grant-admin-consent)
procedure for role requirements and portal details.

Tenant-wide admin consent allows assigned identities to complete sign-in; it
does not give every tenant user access. **Assignment required?** and the
security-group assignment remain the access boundary.

## Recommended access model: security group

Use a dedicated Entra security group, such as
`sg-azure-architecture-review-users`, as the normal access boundary. Assign the
group to the Enterprise Application once, then onboard and offboard people by
changing group membership. This is preferred over individual application
assignments because membership is easier to audit, review, and manage at scale.

Nested groups do not grant Enterprise Application access. Every user and guest
must be a direct member of the assigned security group.

### Assign the security group to the application

Perform this once for each dedicated access group:

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Open **Entra ID > Groups > All groups** and create or select the dedicated
   **Security** group.
3. Open **Entra ID > Enterprise apps > All applications**.
4. Select `Azure Architecture Studio - Web`. Use the **Enterprise application**,
   not the similarly named App Registration. Confirm its Application ID matches
   the repository variable `ENTRA_AUTH_CLIENT_ID` or the client ID shown in a
   sign-in error.
5. Open **Users and groups > Add user/group**.
6. Select the security group, keep **Default Access** as the role, and select
   **Assign**.
7. Return to **Users and groups** and confirm that the group appears.

### Add a user to the security group

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Open **Entra ID > Users > All users** and confirm that the person exists in
   this tenant.
3. For an employee in this tenant, create or select the member account. For an
   external collaborator, select **New user > Invite external user**, enter the
   email address, and send the invitation. Entra creates a guest object whose
   user principal name normally contains `#EXT#`.
4. Open **Entra ID > Groups > All groups** and select the dedicated application
   access group.
5. Open **Members > Add members**, select the member or guest tenant object, and
   confirm the addition.
6. Confirm that the user appears as a direct member of the group.

Allow a few minutes for propagation. Have the user open the application in an
InPrivate or incognito window, or sign out through `https://<app-host>/.auth/logout`
before trying again. A guest signs in with their home organization credentials,
but Entra authorizes the guest object created in this tenant.

Microsoft's portal procedure is documented in
[Manage users and groups assignment to an application](https://learn.microsoft.com/entra/identity/enterprise-apps/assign-user-or-group-access-portal).

## Direct user assignment

Use a direct assignment only for initial validation, a documented exception, or
when group-based assignment is unavailable:

1. Open **Entra ID > Enterprise apps > All applications > Azure Architecture
   Review - Web**.
2. Open **Users and groups > Add user/group**.
3. Select the member or guest tenant object.
4. Keep **Default Access** as the role, select **Assign**, and confirm that the
   user appears as a direct assignment.

## Assign access during initial setup

The setup script can assign an existing security group while it creates the
application:

```powershell
./infra/setup.ps1 -SubscriptionId '<subscription-id>' `
   -AssignGroups '<security-group-object-id>'
```

This is the recommended option for ongoing access. The group must already exist
and be security-enabled. The installer is also assigned directly for bootstrap
access.

Use `-AssignUsers` only when direct assignments are required:

```powershell
./infra/setup.ps1 -SubscriptionId '<subscription-id>' `
   -AssignUsers @('member@contoso.com', '<guest-object-id>')
```

Use a guest's object ID or `#EXT#` user principal name because its email address
might not resolve through `az ad user show --id`. The script stops if a requested
user or group cannot be resolved, preventing a successful deployment with
incomplete access configuration. No application deployment is required for
later membership changes.

## Remove access

For group-managed access, remove the user from the dedicated security group. Do
not remove the group from the Enterprise Application unless access should be
revoked for every member. For a direct assignment, open the Enterprise
Application's **Users and groups** page, select the user, and select **Remove**.

Either change blocks future token issuance. An existing Easy Auth session can
remain valid until its session cookie or token expires; have the user visit
`https://<app-host>/.auth/logout` when immediate sign-out is needed.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `AADSTS50105` | Confirm the security group is assigned to the Enterprise Application and the tenant identity is a direct group member. Use a direct application assignment only as an exception. |
| **Need admin approval** after assignment | Grant and verify the one-time tenant admin consent under the Enterprise Application's **Permissions** page. Group or direct assignment does not grant OAuth consent. |
| Guest cannot be found by email | Find the guest under **Entra ID > Users** and select its `#EXT#` identity or object ID. |
| Assignment exists but the error remains | Confirm the client ID in the error matches `ENTRA_AUTH_CLIENT_ID`, verify the user selected the same account that was assigned, then retry in an InPrivate window after propagation. |
| User is assigned through a group | Confirm Entra ID P1/P2 licensing, that the security group itself is assigned to the application, and that the user is a direct group member. |
| Sign-in is blocked after assignment | Review guest invitation status, tenant consent requirements, and Conditional Access policies. |

Do not work around an assignment failure by disabling **Assignment required?**
or Container Apps authentication. Those controls are the application's intended
access boundary.