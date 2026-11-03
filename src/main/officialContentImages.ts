import { open, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";

import {
  getOfficialContent,
  officialContentImageScheme,
  officialContentImageUrl,
  officialPackageIdFromImageUrl,
  type RimWorldOfficialPackageId,
} from "../shared/officialContent";
import { log } from "./logging";

const previewRelativePath = ["About", "Preview.png"] as const;
const pngSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const maximumPreviewBytes = 16 * 1024 * 1024;

export interface ApprovedOfficialContentImage {
  packageId: RimWorldOfficialPackageId;
  path: string;
  url: string;
}

type Warn = (event: string, data?: unknown) => void;
type ImageProtocolRequest = Pick<Request, "method" | "url">;
type SchemeRegistrar = Pick<Electron.Protocol, "registerSchemesAsPrivileged">;
type ProtocolHandler = Pick<Electron.Protocol, "handle">;

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= pngSignature.byteLength &&
    pngSignature.every((value, index) => bytes[index] === value)
  );
}

export class OfficialContentImageStore {
  private approved = new Map<RimWorldOfficialPackageId, string>();

  constructor(private readonly warn: Warn = log.warn) {}

  async inspect(
    packageId: string,
    localPath: string,
  ): Promise<ApprovedOfficialContentImage | undefined> {
    const content = getOfficialContent(packageId);
    if (!content) {
      return undefined;
    }
    const candidate = join(localPath, ...previewRelativePath);
    try {
      if (basename(localPath).toLowerCase() !== content.folderName.toLowerCase()) {
        throw new Error(
          `Official package ${content.packageId} must be installed in the ${content.folderName} Data folder.`,
        );
      }
      const [root, path] = await Promise.all([realpath(localPath), realpath(candidate)]);
      if (!isInside(root, path)) {
        throw new Error("The preview resolves outside its installed package directory.");
      }
      const details = await stat(path);
      if (!details.isFile()) {
        throw new Error("The preview path is not a file.");
      }
      if (details.size < pngSignature.byteLength || details.size > maximumPreviewBytes) {
        throw new Error("The preview image size is invalid.");
      }
      const file = await open(path, "r");
      try {
        const signature = Buffer.alloc(pngSignature.byteLength);
        const { bytesRead } = await file.read(signature, 0, signature.byteLength, 0);
        if (bytesRead !== signature.byteLength || !isPng(signature)) {
          throw new Error("The installed preview is not a valid PNG image.");
        }
      } finally {
        await file.close();
      }
      return {
        packageId: content.packageId,
        path,
        url: officialContentImageUrl(content.packageId),
      };
    } catch (error) {
      this.warn("rimworld.official-preview.unavailable", {
        packageId: content.packageId,
        path: candidate,
        error,
      });
      return undefined;
    }
  }

  replace(images: readonly ApprovedOfficialContentImage[]): void {
    this.approved = new Map(images.map((image) => [image.packageId, image.path]));
  }

  async response(request: ImageProtocolRequest): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const packageId = officialPackageIdFromImageUrl(request.url);
    const path = packageId ? this.approved.get(packageId) : undefined;
    if (!packageId || !path) {
      return new Response(null, { status: 404 });
    }
    try {
      if ((await realpath(path)) !== path) {
        throw new Error("The approved preview path no longer resolves to the scanned file.");
      }
      const bytes = await readFile(path);
      if (bytes.byteLength > maximumPreviewBytes || !isPng(bytes)) {
        throw new Error("The approved preview is not a valid PNG image.");
      }
      return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=300",
          "Content-Length": String(bytes.byteLength),
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      this.approved.delete(packageId);
      this.warn("rimworld.official-preview.read-failed", { packageId, path, error });
      return new Response(null, { status: 404 });
    }
  }
}

export const officialContentImages = new OfficialContentImageStore();

/** Must run before Electron emits ready. */
export function registerOfficialContentImageScheme(protocol: SchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: officialContentImageScheme,
      privileges: { secure: true, standard: true },
    },
  ]);
}

/** Installs one read-only handler after Electron is ready and before creating the renderer window. */
export function installOfficialContentImageProtocol(
  protocol: ProtocolHandler,
  images: OfficialContentImageStore = officialContentImages,
): void {
  protocol.handle(officialContentImageScheme, (request) => images.response(request));
}
