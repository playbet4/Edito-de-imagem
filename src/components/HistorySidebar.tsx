import { useState } from 'react';
import { History, Loader2, PanelLeftClose, PanelLeftOpen, Pencil, Search, Trash2 } from 'lucide-react';
import type { EditHistoryListItem } from '../types/editHistory';

function formatRelativeTime(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'agora';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `há ${diffD} d`;
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export interface HistorySidebarProps {
  items: EditHistoryListItem[];
  filterQuery: string;
  onFilterChange: (q: string) => void;
  currentHistoryId: string | null;
  isLoadingList: boolean;
  isRestoring: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** Mobile drawer open state */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  /** Render desktop rail, mobile trigger, or both (default). */
  variant?: 'desktop' | 'mobile' | 'all';
}

export function HistorySidebar({
  items,
  filterQuery,
  onFilterChange,
  currentHistoryId,
  isLoadingList,
  isRestoring,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onDelete,
  onRename,
  mobileOpen,
  onMobileOpenChange,
  variant = 'all',
}: HistorySidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startRename = (item: EditHistoryListItem) => {
    setEditingId(item.id);
    setDraftName(item.displayName);
    setConfirmDeleteId(null);
  };

  const commitRename = () => {
    if (!editingId) return;
    const name = draftName.trim();
    if (name) onRename(editingId, name);
    setEditingId(null);
  };

  const panelBody = (
    <>
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <History size={16} className="text-loft-orange flex-shrink-0" />
          <h2 className="text-sm font-bold text-loft-green truncate">Histórico</h2>
        </div>
        <button
          type="button"
          onClick={() => {
            onToggleCollapsed();
            onMobileOpenChange(false);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-loft-green/70 hover:bg-loft-green/5 hover:text-loft-green"
          title="Recolher histórico"
          aria-label="Recolher histórico"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <p className="px-3 text-[11px] leading-snug text-loft-green/60">
        Salvo só neste navegador. Miniatura: fundo escuro se a logo for clara,
        claro se for colorida.
      </p>

      <div className="px-3 pt-3 pb-2">
        <label className="relative block">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-loft-green/40"
          />
          <input
            type="search"
            value={filterQuery}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Buscar imobiliária…"
            aria-label="Buscar imobiliária no histórico"
            className="w-full rounded-xl border border-loft-green/15 bg-white/90 py-2 pl-8 pr-3 text-xs text-loft-green placeholder:text-loft-green/40 outline-none focus:border-loft-orange/40 focus:ring-2 focus:ring-loft-orange/15"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1.5 min-h-0">
        {isLoadingList && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-loft-green/55">
            <Loader2 size={14} className="animate-spin" />
            Carregando…
          </div>
        )}

        {!isLoadingList && items.length === 0 && (
          <p className="px-2 py-8 text-center text-xs leading-relaxed text-loft-green/55">
            {filterQuery.trim()
              ? 'Nenhum resultado para essa busca.'
              : 'Nenhuma logo no histórico ainda. Envie uma imagem para começar.'}
          </p>
        )}

        {!isLoadingList &&
          items.length > 0 &&
          items.map((item) => {
            const active = item.id === currentHistoryId;
            const confirming = confirmDeleteId === item.id;
            const renaming = editingId === item.id;

            return (
              <div
                key={item.id}
                className={`group rounded-xl border p-2 transition-colors ${
                  active
                    ? 'border-loft-orange/40 bg-loft-orange/10'
                    : 'border-transparent bg-white/50 hover:border-loft-green/15 hover:bg-white/80'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (renaming) return;
                    onSelect(item.id);
                    onMobileOpenChange(false);
                  }}
                  disabled={isRestoring}
                  className="flex w-full items-start gap-2.5 text-left disabled:opacity-60"
                  aria-label={`Abrir ${item.displayName}`}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-loft-green/10 bg-[#0b1220]">
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    {renaming ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onBlur={commitRename}
                        className="w-full rounded-md border border-loft-orange/30 bg-white px-1.5 py-0.5 text-xs font-semibold text-loft-green outline-none"
                        aria-label="Renomear imobiliária"
                      />
                    ) : (
                      <span className="block truncate text-xs font-semibold text-loft-green">
                        {item.displayName}
                      </span>
                    )}
                    <span className="mt-0.5 block text-[10px] text-loft-green/50">
                      {formatRelativeTime(item.updatedAt)}
                    </span>
                  </span>
                </button>

                <div className="mt-1.5 flex items-center justify-end gap-1">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(item.id);
                          setConfirmDeleteId(null);
                        }}
                        className="rounded-md bg-red-500/90 px-2 py-1 text-[10px] font-bold text-white"
                      >
                        Excluir
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-md px-2 py-1 text-[10px] font-semibold text-loft-green/70 hover:bg-loft-green/5"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startRename(item)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-loft-green/45 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-loft-green/5 hover:text-loft-green"
                        title="Renomear"
                        aria-label={`Renomear ${item.displayName}`}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(item.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-loft-green/45 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                        title="Excluir do histórico"
                        aria-label={`Excluir ${item.displayName}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {isRestoring && (
        <div className="flex items-center justify-center gap-2 border-t border-loft-green/10 px-3 py-2 text-[11px] text-loft-green/65">
          <Loader2 size={12} className="animate-spin" />
          Abrindo logo…
        </div>
      )}
    </>
  );

  const showDesktop = variant === 'desktop' || variant === 'all';
  const showMobile = variant === 'mobile' || variant === 'all';

  return (
    <>
      {showDesktop && (
        <aside
          className={`hidden lg:flex flex-col flex-shrink-0 transition-[width] duration-200 ${
            collapsed ? 'w-12' : 'w-[240px]'
          }`}
          aria-label="Histórico de logos"
        >
          {collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="glass-panel sticky top-4 flex h-[min(70vh,560px)] w-12 flex-col items-center gap-3 py-4 text-loft-green shadow-loft"
              title="Abrir histórico"
              aria-label="Abrir histórico"
              aria-expanded={false}
            >
              <PanelLeftOpen size={18} />
              <History size={16} className="text-loft-orange" />
              <span
                className="mt-2 text-[10px] font-bold uppercase tracking-wider text-loft-green/55"
                style={{ writingMode: 'vertical-rl' }}
              >
                Histórico
              </span>
            </button>
          ) : (
            <div className="glass-panel sticky top-4 flex h-[min(70vh,560px)] flex-col overflow-hidden shadow-loft">
              {panelBody}
            </div>
          )}
        </aside>
      )}

      {showMobile && (
        <>
          <button
            type="button"
            onClick={() => onMobileOpenChange(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/85 px-3 py-2 text-xs font-semibold text-loft-green shadow-loft backdrop-blur-md"
            aria-label="Abrir histórico de logos"
          >
            <History size={14} className="text-loft-orange" />
            Histórico
            {items.length > 0 && (
              <span className="rounded-full bg-loft-orange/15 px-1.5 py-0.5 text-[10px] font-bold text-loft-orange">
                {items.length}
              </span>
            )}
          </button>

          {mobileOpen && (
            <div
              className="fixed inset-0 z-50"
              role="dialog"
              aria-modal="true"
              aria-label="Histórico"
            >
              <button
                type="button"
                className="absolute inset-0 bg-loft-green/40 backdrop-blur-[2px]"
                aria-label="Fechar histórico"
                onClick={() => onMobileOpenChange(false)}
              />
              <div className="absolute inset-y-0 left-0 flex w-[min(100%,300px)] flex-col bg-[#f3f6f4] shadow-2xl">
                <div className="glass-panel m-2 flex min-h-0 flex-1 flex-col overflow-hidden">
                  {panelBody}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}