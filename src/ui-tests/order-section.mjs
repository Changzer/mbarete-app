export async function openOrderSection(page, testId) {
  const toggle = page.getByTestId(`${testId}-toggle`);
  if (await toggle.getAttribute("aria-expanded") === "false") {
    await toggle.click();
  }
}
