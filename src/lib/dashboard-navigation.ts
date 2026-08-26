export function isDashboardPathActive(
  pathname: string,
  destination: string,
): boolean {
  if (destination === "/dashboard") return pathname === destination;
  return pathname === destination || pathname.startsWith(`${destination}/`);
}

export function dashboardNavigationGroupId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `dashboard-nav-${slug}`;
}
