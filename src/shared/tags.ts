import type { ConstantValue } from "./domainConstants";
import type { ModTag, ModVault } from "./types";

export const tagSaveModes = Object.freeze({ create: "create", edit: "edit" } as const);

export function assignTagsToMods(
  vault: ModVault,
  modIds: string[],
  tagIds: string[],
  assigned: boolean,
): ModVault {
  const ids = new Set(modIds);
  const tagSet = new Set(tagIds);
  if (!ids.size || !tagSet.size) {
    return vault;
  }
  const saved = new Set(vault.mods.map((mod) => mod.id));
  const tags = new Set(vault.userTags.map((tag) => tag.id));
  if ([...ids].some((id) => !saved.has(id)) || [...tagSet].some((id) => !tags.has(id))) {
    throw new Error(
      "The selected mods or tags changed. No tags were edited; review your selection.",
    );
  }
  return {
    ...vault,
    mods: vault.mods.map((mod) =>
      ids.has(mod.id)
        ? {
            ...mod,
            userTagIds: assigned
              ? [...new Set([...(mod.userTagIds ?? []), ...tagSet])]
              : mod.userTagIds?.filter((id) => !tagSet.has(id)),
          }
        : mod,
    ),
  };
}

export function tagNameExists(tags: ModTag[], name: string, exceptId?: string) {
  return tags.some(
    (tag) => tag.id !== exceptId && tag.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
}

export function saveUserTag(
  vault: ModVault,
  tag: ModTag,
  mode: ConstantValue<typeof tagSaveModes>,
  assignToModIds?: string[],
): ModVault {
  const tags = vault.userTags;
  const existing = tags.find((entry) => entry.id === tag.id);
  if (
    !tag.name.trim() ||
    tagNameExists(tags, tag.name, mode === tagSaveModes.edit ? tag.id : undefined)
  ) {
    throw new Error("Choose a unique, nonempty tag name. No tags were edited.");
  }
  if ((mode === tagSaveModes.edit && !existing) || (mode === tagSaveModes.create && existing)) {
    throw new Error("The tag changed. No tags were edited; review your selection.");
  }
  const next = {
    ...vault,
    userTags:
      mode === tagSaveModes.edit
        ? tags.map((entry) => (entry.id === tag.id ? { ...entry, ...tag } : entry))
        : [...tags, tag],
  };
  return assignToModIds ? assignTagsToMods(next, assignToModIds, [tag.id], true) : next;
}
