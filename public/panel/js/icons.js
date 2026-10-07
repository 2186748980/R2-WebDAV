// Inline SVG icon set — 24×24 stroke geometry on one shared grid so every
// glyph has consistent optical weight. Renders with currentColor; no fonts,
// no external assets. Names only ever come from code, never from user data.

const PATHS = {
  "folder": '<path d="M3.2 7.2c0-1.2 1-2.2 2.2-2.2h3.9c.7 0 1.4.3 1.8.9l.9 1.1h6.8c1.2 0 2.2 1 2.2 2.2v8.6c0 1.2-1 2.2-2.2 2.2H5.4c-1.2 0-2.2-1-2.2-2.2z"/>',
  "folder-plus": '<path d="M3.2 7.2c0-1.2 1-2.2 2.2-2.2h3.9c.7 0 1.4.3 1.8.9l.9 1.1h6.8c1.2 0 2.2 1 2.2 2.2v8.6c0 1.2-1 2.2-2.2 2.2H5.4c-1.2 0-2.2-1-2.2-2.2z"/><path d="M12 10.8v5.4M9.3 13.5h5.4"/>',
  "file": '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19"/>',
  "file-text": '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19"/><path d="M9 13.2h6M9 16.4h4"/>',
  "file-code": '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19"/><path d="m10.6 11.9-2.2 2.3 2.2 2.3M13.4 11.9l2.2 2.3-2.2 2.3"/>',
  "image": '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.8" cy="9.8" r="1.5"/><path d="m3.8 16.4 4.2-3.9a1.3 1.3 0 0 1 1.8 0l6 5.6M13.5 15.5l2.1-1.9a1.3 1.3 0 0 1 1.8 0l2.8 2.6"/>',
  "video": '<rect x="3" y="5.5" width="18" height="13" rx="2.2"/><path d="M7.5 5.5v13M16.5 5.5v13M3 11.2h4.5M16.5 11.2H21M3 14.8h4.5M16.5 14.8H21"/>',
  "audio": '<path d="M9.3 17V6.5l9.4-1.9v10.6"/><circle cx="6.9" cy="17" r="2.4"/><circle cx="16.3" cy="15.2" r="2.4"/>',
  "archive": '<rect x="4" y="3.5" width="16" height="4.6" rx="1.1"/><path d="M5.5 8.1V18a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.1"/><path d="M10 12.2h4"/>',
  "search": '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  "upload": '<path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9"/><path d="M4.5 19.5h15"/>',
  "download": '<path d="M12 4.5v11M7.5 11l4.5 4.5L16.5 11"/><path d="M4.5 19.5h15"/>',
  "trash": '<path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5"/><path d="m6.5 6.5.9 12.4a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12.4"/><path d="M10 10.5v6M14 10.5v6"/>',
  "edit": '<path d="M16.8 4.2a2.12 2.12 0 0 1 3 3L8.5 18.5 4 19.5l1-4.5z"/><path d="m14.8 6.2 3 3"/>',
  "copy": '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5.5 14.5V6a2 2 0 0 1 2-2H16"/>',
  "move": '<path d="m14.5 14 5-5-5-5"/><path d="M19.5 9H10a5.5 5.5 0 0 0-5.5 5.5V20"/>',
  "link": '<path d="M9.6 14.4a4.2 4.2 0 0 0 5.9 0l3.6-3.6a4.24 4.24 0 0 0-6-6l-1.8 1.8"/><path d="M14.4 9.6a4.2 4.2 0 0 0-5.9 0L4.9 13.2a4.24 4.24 0 0 0 6 6l1.8-1.8"/>',
  "more": '<circle cx="12" cy="5.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="18.8" r="1.2" fill="currentColor" stroke="none"/>',
  "plus": '<path d="M12 5v14M5 12h14"/>',
  "grid": '<rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/>',
  "list": '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.9" cy="6" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.9" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.9" cy="18" r="1.15" fill="currentColor" stroke="none"/>',
  "sun": '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
  "moon": '<path d="M20 13.6A8.4 8.4 0 1 1 10.4 4a6.6 6.6 0 0 0 9.6 9.6z"/>',
  "x": '<path d="m6 6 12 12M18 6 6 18"/>',
  "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
  "chevron-right": '<path d="m9.2 5.5 6.5 6.5-6.5 6.5"/>',
  "refresh": '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20.5 3.5V9H15"/>',
  "eye": '<path d="M2.8 12S6.3 5.8 12 5.8 21.2 12 21.2 12 17.7 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  "eye-off": '<path d="M4 4l16 16"/><path d="M10.6 6A9.6 9.6 0 0 1 12 5.8c5.7 0 9.2 6.2 9.2 6.2a17.4 17.4 0 0 1-2.8 3.5M6.5 6.7C3.9 8.5 2.8 12 2.8 12s3.5 6.2 9.2 6.2a9.3 9.3 0 0 0 3.5-.7"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/>',
  "info": '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.2v4.8"/><circle cx="12" cy="8.2" r="1" fill="currentColor" stroke="none"/>',
  "alert": '<path d="M12 4.2 3.4 19a1.3 1.3 0 0 0 1.1 2h15a1.3 1.3 0 0 0 1.1-2z"/><path d="M12 9.8v4.4"/><circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none"/>',
  "logout": '<path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5"/><path d="m15.5 16.5 4.5-4.5-4.5-4.5"/><path d="M20 12H9.5"/>',
  "home": '<path d="m3.5 10.8 8.5-7 8.5 7"/><path d="M5.5 9.4V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.4"/><path d="M10 20.5v-5.6h4v5.6"/>',
  "globe": '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5a13.5 13.5 0 0 1 0 17 13.5 13.5 0 0 1 0-17"/>',
  "sliders": '<path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="8.5" cy="16.5" r="2"/>',
  "check": '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.4"/>',
  "shield": '<path d="M12 3 5 5.8v5.4c0 4.4 3 8 7 9.8 4-1.8 7-5.4 7-9.8V5.8z"/><path d="m9 12 2.2 2.2L15.5 9.9"/>',
  "key": '<circle cx="8" cy="15.5" r="4.2"/><path d="m11.2 12.5 8.3-8.3M16 7.5l2.7 2.7M13.5 5l2.7 2.7"/>',
  "drive": '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M3 13.5h18"/><circle cx="16.8" cy="15.3" r="1" fill="currentColor" stroke="none"/>',
};

const EXT_ICONS = [
  ["image", ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif", "ico", "heic"]],
  ["video", ["mp4", "webm", "mov", "m4v", "mkv", "avi", "flv"]],
  ["audio", ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"]],
  ["archive", ["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "tgz"]],
  ["file-code", ["js", "mjs", "ts", "css", "html", "htm", "json", "xml", "yaml", "yml", "toml", "sh", "py", "ini", "conf", "sql", "go", "rs", "java"]],
  ["file-text", ["txt", "md", "log", "csv", "pdf", "doc", "docx"]],
];

export function icon(name, size = 20) {
  const body = PATHS[name] || PATHS.file;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function iconForName(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "file";
  const ext = name.slice(dot + 1).toLowerCase();
  for (const [glyph, extensions] of EXT_ICONS) {
    if (extensions.includes(ext)) return glyph;
  }
  return "file";
}

export function iconForItem(item) {
  return item.type === "directory" ? "folder" : iconForName(item.name);
}
