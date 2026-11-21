export function extractYouTubeId(input:string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com"].includes(u.hostname)) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const parts = u.pathname.split("/");
      if (["embed","shorts","live"].includes(parts[1])) return parts[2] || null;
    }
  } catch {}
  return /^[a-zA-Z0-9_-]{11}$/.test(input.trim()) ? input.trim() : null;
}
export const videoThumb = (id:string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;