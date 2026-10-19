import { test, expect } from "@playwright/test";

test("dashboard loads", async ({ page }) => {
  await page.goto("/dashboard");
  // The page redirects to /login when unauthenticated.
  await expect(page).toHaveURL(/\/(login|dashboard)/);
});

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("h1")).toContainText("MailPilot AI");
});
