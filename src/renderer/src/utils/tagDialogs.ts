import type { ModTag } from "../../../shared/types";

export const tagDialogKinds = Object.freeze({
  closed: "closed",
  manager: "manager",
  bulk: "bulk",
  editor: "editor",
  delete: "delete",
} as const);
export const tagDialogActions = Object.freeze({
  manage: "manage",
  bulk: "bulk",
  create: "create",
  edit: "edit",
  delete: "delete",
  close: "close",
  saved: "saved",
} as const);

export interface BulkTagOperation {
  modIds: string[];
  assigned: boolean;
  createdTagId?: string;
}

type ReturnDialog =
  | { kind: typeof tagDialogKinds.closed }
  | { kind: typeof tagDialogKinds.manager }
  | { kind: typeof tagDialogKinds.bulk; operation: BulkTagOperation };

export type TagDialog =
  | ReturnDialog
  | {
      kind: typeof tagDialogKinds.editor;
      tag?: ModTag;
      initialName: string;
      assignToModIds?: string[];
      previous: ReturnDialog;
    }
  | { kind: typeof tagDialogKinds.delete; tag: ModTag };

export type TagDialogAction =
  | { type: typeof tagDialogActions.manage }
  | { type: typeof tagDialogActions.bulk; modIds: string[]; assigned: boolean }
  | { type: typeof tagDialogActions.create; initialName: string; modIds?: string[] }
  | { type: typeof tagDialogActions.edit; tag: ModTag }
  | { type: typeof tagDialogActions.delete; tag: ModTag }
  | { type: typeof tagDialogActions.close }
  | { type: typeof tagDialogActions.saved; tagId: string };

export const closedTagDialog: TagDialog = { kind: tagDialogKinds.closed };

export function tagDialogReducer(state: TagDialog, action: TagDialogAction): TagDialog {
  switch (action.type) {
    case tagDialogActions.manage:
      return state.kind === tagDialogKinds.closed ? { kind: tagDialogKinds.manager } : state;
    case tagDialogActions.bulk:
      return state.kind === tagDialogKinds.closed && action.modIds.length
        ? {
            kind: tagDialogKinds.bulk,
            operation: { assigned: action.assigned, modIds: [...action.modIds] },
          }
        : state;
    case tagDialogActions.create:
      if (
        state.kind === tagDialogKinds.editor ||
        state.kind === tagDialogKinds.delete ||
        (state.kind === tagDialogKinds.bulk && !state.operation.assigned)
      ) {
        return state;
      }
      return {
        kind: tagDialogKinds.editor,
        initialName: action.initialName,
        assignToModIds: action.modIds ? [...action.modIds] : undefined,
        previous: state,
      };
    case tagDialogActions.edit:
      return state.kind === tagDialogKinds.manager
        ? { kind: tagDialogKinds.editor, tag: action.tag, initialName: "", previous: state }
        : state;
    case tagDialogActions.delete:
      return state.kind === tagDialogKinds.manager
        ? { kind: tagDialogKinds.delete, tag: action.tag }
        : state;
    case tagDialogActions.close:
      if (state.kind === tagDialogKinds.editor) {
        return state.previous;
      }
      return state.kind === tagDialogKinds.delete
        ? { kind: tagDialogKinds.manager }
        : closedTagDialog;
    case tagDialogActions.saved:
      if (state.kind !== tagDialogKinds.editor) {
        return state;
      }
      return state.previous.kind === tagDialogKinds.bulk
        ? {
            kind: tagDialogKinds.bulk,
            operation: { ...state.previous.operation, createdTagId: action.tagId },
          }
        : state.previous;
  }
}

export function bulkTagOperation(dialog: TagDialog): BulkTagOperation | undefined {
  if (dialog.kind === tagDialogKinds.bulk) {
    return dialog.operation;
  }
  if (dialog.kind === tagDialogKinds.editor && dialog.previous.kind === tagDialogKinds.bulk) {
    return dialog.previous.operation;
  }
  return undefined;
}
