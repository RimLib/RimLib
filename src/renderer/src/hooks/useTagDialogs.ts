import { useCallback, useReducer } from "react";

import { assignTagsToMods, saveUserTag, tagSaveModes } from "../../../shared/tags";
import { createId } from "../utils/mods";
import {
  closedTagDialog,
  tagDialogActions,
  tagDialogKinds,
  tagDialogReducer,
} from "../utils/tagDialogs";
import type { useActionNotifications } from "./useActionNotifications";
import type { useModVault } from "./useModVault";

interface TagDialogDependencies {
  busy: boolean;
  update: ReturnType<typeof useModVault>["update"];
  deleteTag: ReturnType<typeof useModVault>["deleteTag"];
  perform: ReturnType<typeof useActionNotifications>["perform"];
  setNotice: (message: string) => void;
}

export function useTagDialogs({
  busy,
  update,
  deleteTag,
  perform,
  setNotice,
}: TagDialogDependencies) {
  const [dialog, dispatch] = useReducer(tagDialogReducer, closedTagDialog);

  const assign = useCallback(
    (modIds: string[], tagIds: string[], assigned: boolean) => {
      void perform(() => {
        if (!busy) {
          update((previous) => assignTagsToMods(previous, modIds, tagIds, assigned));
        }
      });
    },
    [busy, update, perform],
  );

  function save(name: string, color: string) {
    void perform(() => {
      if (busy || dialog.kind !== tagDialogKinds.editor) {
        return;
      }
      const tag = { id: dialog.tag?.id ?? createId("tag"), name, color };
      update((previous) =>
        saveUserTag(
          previous,
          tag,
          dialog.tag ? tagSaveModes.edit : tagSaveModes.create,
          dialog.assignToModIds,
        ),
      );
      dispatch({ type: tagDialogActions.saved, tagId: tag.id });
      setNotice("Tag saved");
    });
  }

  function remove() {
    void perform(() => {
      if (busy || dialog.kind !== tagDialogKinds.delete) {
        return;
      }
      deleteTag(dialog.tag.id);
      dispatch({ type: tagDialogActions.close });
      setNotice("Tag deleted; library and subscriptions retained");
    });
  }

  function applyBulk(tagIds: string[]) {
    void perform(() => {
      if (busy || dialog.kind !== tagDialogKinds.bulk) {
        return;
      }
      const { modIds, assigned } = dialog.operation;
      update((previous) => assignTagsToMods(previous, modIds, tagIds, assigned));
      dispatch({ type: tagDialogActions.close });
      setNotice(`Tags ${assigned ? "added to" : "removed from"} ${modIds.length} mods`);
    });
  }

  return { dialog, dispatch, assign, save, remove, applyBulk };
}
