import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderPlus,
  History,
  House,
  LayoutGrid,
  Link as LinkIcon,
  List as ListIcon,
  Lock,
  LogOut,
  Mail,
  Moon,
  Package,
  PackagePlus,
  Pencil,
  Save,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Icon as FdnIcon, type IconProps as FdnIconProps } from "@foundathyon/community-ui";

// A name → component registry over the design system's Icon. The DS is what
// actually renders (one stroke width, one size scale, currentColor); this only
// spares ~40 call sites an import each, and keeps the icon set closed so a
// page can't reach for a glyph nobody vetted.
const icons = {
  package: Package,
  folder: Folder,
  "folder-plus": FolderPlus,
  "package-plus": PackagePlus,
  file: File,
  "file-code": FileCode,
  "file-json": FileJson,
  "file-text": FileText,
  "file-image": FileImage,
  "file-cog": FileCog,
  "file-archive": FileArchive,
  "file-type": FileType,
  "trash-2": Trash2,
  upload: Upload,
  download: Download,
  pencil: Pencil,
  "external-link": ExternalLink,
  history: History,
  lock: Lock,
  "layout-grid": LayoutGrid,
  list: ListIcon,
  "chevron-right": ChevronRight,
  sun: Sun,
  moon: Moon,
  house: House,
  "arrow-left": ArrowLeft,
  save: Save,
  x: X,
  "triangle-alert": TriangleAlert,
  "circle-check": CircleCheck,
  user: User,
  users: Users,
  "log-out": LogOut,
  mail: Mail,
  link: LinkIcon,
  copy: Copy,
  eye: Eye,
  "eye-off": EyeOff,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export function Icon({
  name,
  size,
  label,
  className,
}: {
  name: IconName;
  size?: FdnIconProps["size"];
  label?: string;
  className?: string;
}) {
  return <FdnIcon icon={icons[name]} size={size} label={label} className={className} />;
}
