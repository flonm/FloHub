export const BAR_STYLES = `
:host {
  --rb-fg: var(--fgColor-default, #1f2328);
  --rb-muted: var(--fgColor-muted, #59636e);
  --rb-bg: var(--bgColor-default, #ffffff);
  --rb-bg-muted: var(--bgColor-muted, #f6f8fa);
  --rb-border: var(--borderColor-default, #d1d9e0);
  --rb-success: var(--fgColor-success, #1a7f37);
  --rb-danger: var(--fgColor-danger, #d1242f);
  --rb-attention: var(--fgColor-attention, #9a6700);
  --rb-accent: var(--fgColor-accent, #0969da);
  --rb-done: var(--fgColor-done, #8250df);
  --rb-focus: var(--focus-outlineColor, #0969da);
  --rb-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140, 149, 159, 0.2));
  display: block;
  color: var(--rb-fg);
  font: 12px/1.5 var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
}
:host([hidden]) { display: none; }
:host([data-mode="inline"]) { margin: 8px 0 4px; }
:host([data-mode="floating"]) {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 90;
  max-width: calc(100vw - 32px);
}

* { box-sizing: border-box; }
svg { flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
svg .fill { fill: currentColor; stroke: none; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--rb-focus); outline-offset: 1px; }

.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.label { font-weight: 600; color: var(--rb-muted); }
.refresh { width: 20px; height: 20px; margin: 0 2px 0 -6px; }
.refresh svg { width: 12px; height: 12px; }
.chips { display: contents; list-style: none; margin: 0; padding: 0; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 4px 2px 3px;
  border: 1px solid var(--rb-border);
  border-radius: 999px;
  background: var(--rb-bg);
}
.chip:not(:has(.icon-button)) { padding-right: 10px; }
.avatar { width: 20px; height: 20px; border-radius: 50%; background: var(--rb-bg-muted); }
.avatar.team { border-radius: 6px; }
.avatar.placeholder { display: inline-flex; align-items: center; justify-content: center; color: var(--rb-muted); }
.name { color: var(--rb-fg); font-weight: 600; text-decoration: none; }
.name:hover { color: var(--rb-accent); text-decoration: underline; }
.status { display: inline-flex; align-items: center; gap: 3px; }
.previous { color: var(--rb-muted); }

[data-tone="success"] { color: var(--rb-success); }
[data-tone="danger"] { color: var(--rb-danger); }
[data-tone="attention"] { color: var(--rb-attention); }
[data-tone="muted"] { color: var(--rb-muted); }

.icon-button, .text-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.icon-button { width: 24px; height: 24px; color: var(--rb-muted); border-radius: 50%; }
.icon-button:hover:not(:disabled), .text-button:hover { background: var(--rb-bg-muted); color: var(--rb-fg); }
.icon-button:disabled { cursor: progress; }
.text-button { min-height: 24px; padding: 0 8px; color: var(--rb-accent); font-weight: 600; }

.spinning svg { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.message { color: var(--rb-muted); }
.notice { flex-basis: 100%; color: var(--rb-danger); }
.notice:empty { display: none; }

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 4px 12px 4px 6px;
  border: 1px solid var(--rb-border);
  border-radius: 999px;
  background: var(--rb-bg);
  box-shadow: var(--rb-shadow);
  cursor: pointer;
}
.pill:hover { background: var(--rb-bg-muted); }
.faces { display: inline-flex; align-items: center; }
.face { position: relative; display: inline-flex; margin-right: -4px; }
.face .avatar { width: 24px; height: 24px; outline: 2px solid var(--rb-bg); }
.badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--rb-bg);
  box-shadow: 0 0 0 1px var(--rb-border);
}
.badge svg { width: 10px; height: 10px; stroke-width: 2.25; }
.more { margin-left: 8px; color: var(--rb-muted); font-weight: 600; }
.summary { margin-left: 6px; font-weight: 600; }
.chevron { color: var(--rb-muted); transition: transform 120ms ease; }
.pill[aria-expanded="true"] .chevron { transform: rotate(180deg); }

.panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 96px);
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--rb-border);
  border-radius: 12px;
  background: var(--rb-bg);
  box-shadow: var(--rb-shadow);
}
.panel.entering { animation: rise 140ms ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } }

[data-stack-tone="success"] { --tone: var(--rb-success); --tone-bg: var(--bgColor-success-muted, #dafbe1); --tone-border: var(--borderColor-success-muted, rgba(74, 194, 107, 0.4)); }
[data-stack-tone="attention"] { --tone: var(--rb-attention); --tone-bg: var(--bgColor-attention-muted, #fff8c5); --tone-border: var(--borderColor-attention-muted, rgba(212, 167, 44, 0.4)); }
[data-stack-tone="accent"] { --tone: var(--rb-accent); --tone-bg: var(--bgColor-accent-muted, #ddf4ff); --tone-border: var(--borderColor-accent-muted, rgba(84, 174, 255, 0.4)); }
[data-stack-tone="danger"] { --tone: var(--rb-danger); --tone-bg: var(--bgColor-danger-muted, #ffebe9); --tone-border: var(--borderColor-danger-muted, rgba(255, 129, 130, 0.4)); }
[data-stack-tone="done"] { --tone: var(--rb-done); --tone-bg: var(--bgColor-done-muted, #fbefff); --tone-border: var(--borderColor-done-muted, rgba(194, 151, 255, 0.4)); }
[data-stack-tone="neutral"] { --tone: var(--rb-muted); --tone-bg: var(--bgColor-neutral-muted, rgba(175, 184, 193, 0.2)); --tone-border: var(--borderColor-neutral-muted, rgba(175, 184, 193, 0.4)); }

.overview { display: flex; flex-direction: column; gap: 8px; }
.stack-header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  margin-left: -4px;
  padding: 0 6px 0 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.section-toggle:hover { background: var(--rb-bg-muted); }
.section-toggle .chevron, .merged-toggle .chevron { transform: rotate(90deg); }
.section-toggle[aria-expanded="true"] .chevron, .merged-toggle [aria-expanded="true"] .chevron { transform: rotate(180deg); }

.stack-list {
  display: grid;
  grid-template-columns: 16px max-content minmax(0, 1fr) max-content max-content;
  column-gap: 10px;
  max-width: 880px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.stack-list > li { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; }
.entry-link {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  min-height: 28px;
  margin: 0 -6px;
  padding: 0 6px;
  border-radius: 6px;
  color: inherit;
  text-decoration: none;
}
.entry-link:hover { background: var(--rb-bg-muted); }
.entry-link:hover .entry-title { color: var(--rb-accent); }
.entry.current .entry-link { background: var(--bgColor-accent-muted, #ddf4ff); }
.entry.current .entry-number, .entry.current .entry-title { font-weight: 600; }

.rail { position: relative; display: flex; align-self: stretch; align-items: center; justify-content: center; min-height: 28px; }
.rail::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--rb-border);
}
.stack-list > li:first-child .rail::before { top: 50%; }
.trunk .rail::before { bottom: 50%; }
.node { position: relative; width: 10px; height: 10px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 0 2px var(--rb-bg); }
.entry.current .node { width: 12px; height: 12px; box-shadow: 0 0 0 2px var(--rb-bg), 0 0 0 4px var(--tone); }
.trunk-icon { position: relative; background: var(--rb-bg); color: var(--rb-muted); }
.trunk-name { grid-column: 2 / -1; color: var(--rb-muted); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.merged-toggle .text-button { grid-column: 2 / -1; justify-self: start; color: var(--rb-done); }

.state {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  height: 20px;
  padding: 0 8px;
  border: 1px solid var(--tone-border);
  border-radius: 999px;
  background: var(--tone-bg);
  color: var(--tone);
  font-weight: 600;
  white-space: nowrap;
}
.entry-title { overflow: hidden; color: var(--rb-fg); text-overflow: ellipsis; white-space: nowrap; }
.entry-number { color: var(--rb-muted); }
.threads { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; font-variant-numeric: tabular-nums; }
.threads.open { color: var(--rb-fg); font-weight: 600; }
.threads.done { color: var(--rb-muted); }
.age { min-width: 3ch; color: var(--rb-muted); font-variant-numeric: tabular-nums; text-align: right; }

.strip { display: inline-flex; align-items: center; gap: 2px; }
.segment { width: 6px; height: 14px; border-radius: 2px; background: var(--tone); }
.segment.current { height: 18px; outline: 2px solid var(--rb-fg); outline-offset: 1px; }
.divider { align-self: stretch; width: 1px; margin: 4px 2px; background: var(--rb-border); }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .spinning svg, .panel.entering { animation: none; }
  .chevron { transition: none; }
}
`;
