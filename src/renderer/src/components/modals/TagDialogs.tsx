import type { Mod, ModTag } from "../../../../shared/types";
import type { useTagDialogs } from "../../hooks/useTagDialogs";
import { bulkTagOperation, tagDialogActions, tagDialogKinds } from "../../utils/tagDialogs";
import { BulkTagsModal } from "./BulkTagsModal";
import { DeleteTagModal } from "./DeleteTagModal";
import { ManageTagsModal } from "./ManageTagsModal";
import { TagEditorModal } from "./TagEditorModal";

interface TagDialogsProps {
  workflow: ReturnType<typeof useTagDialogs>;
  mods: Mod[];
  tags: ModTag[];
  disabled: boolean;
}

export function TagDialogs({ workflow, mods, tags, disabled }: TagDialogsProps) {
  const { dialog, dispatch } = workflow;
  const operation = bulkTagOperation(dialog);
  const selectedMods: Mod[] = [];
  if (operation) {
    const byId = new Map(mods.map((mod) => [mod.id, mod]));
    for (const id of operation.modIds) {
      const mod = byId.get(id);
      if (mod) {
        selectedMods.push(mod);
      }
    }
  }
  const close = () => {
    dispatch({ type: tagDialogActions.close });
  };

  return (
    <>
      {dialog.kind === tagDialogKinds.manager && (
        <ManageTagsModal
          tags={tags}
          onClose={close}
          onCreate={() => {
            dispatch({ type: tagDialogActions.create, initialName: "" });
          }}
          onEdit={(tag) => {
            dispatch({ type: tagDialogActions.edit, tag });
          }}
          onDelete={(tag) => {
            dispatch({ type: tagDialogActions.delete, tag });
          }}
        />
      )}
      {operation && (
        <BulkTagsModal
          mods={selectedMods}
          tags={tags}
          assigned={operation.assigned}
          disabled={disabled}
          hidden={dialog.kind === tagDialogKinds.editor}
          createdTagId={operation.createdTagId}
          onClose={close}
          onConfirm={workflow.applyBulk}
          onCreateTag={(initialName) => {
            dispatch({ type: tagDialogActions.create, initialName });
          }}
        />
      )}
      {dialog.kind === tagDialogKinds.editor && (
        <TagEditorModal
          tags={tags}
          tag={dialog.tag}
          initialName={dialog.initialName}
          onClose={close}
          onSave={workflow.save}
        />
      )}
      {dialog.kind === tagDialogKinds.delete && (
        <DeleteTagModal
          tag={dialog.tag}
          count={mods.filter((mod) => mod.userTagIds?.includes(dialog.tag.id)).length}
          onClose={close}
          onConfirm={workflow.remove}
        />
      )}
    </>
  );
}
