export async function performUiAction<T>(
  action: () => T | Promise<T>,
  onError: (error: unknown) => void,
): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    onError(error);
    return undefined;
  }
}
