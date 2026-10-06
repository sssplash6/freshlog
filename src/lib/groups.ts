/**
 * A group, in a program that logs its hours as classes, is a student record
 * with no person behind it. `User.email` is required and unique, so a group
 * gets an address nobody can sign in with or receive mail at; the mailer drops
 * anything on this domain.
 */
const GROUP_EMAIL_DOMAIN = "groups.invalid";

export function groupEmail(id: string): string {
  return `group-${id}@${GROUP_EMAIL_DOMAIN}`;
}

export function isGroupEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${GROUP_EMAIL_DOMAIN}`);
}
