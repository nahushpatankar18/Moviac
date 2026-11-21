import React from 'react';
import { Bookmark, Compass, Film, Settings, Tv } from 'lucide-react';
import { ContentFilter } from '../types/tmdb';
import { GoogleAccountButton } from './GoogleAccountButton';
import { PWAInstallButton } from './PWAInstallButton';
import { SearchBar } from './SearchBar';

export type AppView = 'discover' | 'lists';

interface NavbarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  contentType: ContentFilter;
  onSelectContentType: (type: ContentFilter) => void;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSearchFocus: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  totalWatchlistCount: number;
  onOpenSettings: () => void;
  onGoHome: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeView,
  onNavigate,
  contentType,
  onSelectContentType,
  searchQuery,
  onSearchChange,
  onSearchFocus,
  searchInputRef,
  totalWatchlistCount,
  onOpenSettings,
  onGoHome,
}) => {
  return (
    <>
      {/* Fixed Top Frosted Glass Navbar */}
      <header className="glass-panel fixed top-0 right-0 left-0 z-40 border-x-0 border-t-0">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-3 sm:h-16 sm:gap-8 sm:px-6 lg:px-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={onGoHome}
            className="font-display accent-gradient-text whitespace-nowrap shrink-0 text-xl font-extrabold tracking-tight sm:text-2xl"
          >
            Moviac
          </button>

          {/* Prominent Always-Visible Glass Search Bar */}
          <div className="flex flex-1 justify-center">
            <SearchBar
              query={searchQuery}
              onChange={onSearchChange}
              onFocus={onSearchFocus}
              inputRef={searchInputRef}
            />
          </div>

          {/* Mobile Compact Gmail & Install Triggers */}
          <div className="flex items-center gap-1.5 md:hidden shrink-0">
            <GoogleAccountButton compact />
            <PWAInstallButton compact />
          </div>

          {/* Zone 2 & 3 (Desktop): Nav Links, Install & Settings */}
          <nav className="hidden items-center gap-5 md:flex shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('discover')}
              className={`whitespace-nowrap shrink-0 text-sm font-medium transition-colors ${
                activeView === 'discover'
                  ? 'text-white underline decoration-cyan-400 decoration-2 underline-offset-8'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Discover
            </button>

            <button
              type="button"
              onClick={() => onNavigate('lists')}
              className={`whitespace-nowrap shrink-0 text-sm font-medium transition-colors ${
                activeView === 'lists'
                  ? 'text-white underline decoration-cyan-400 decoration-2 underline-offset-8'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              My Lists ({totalWatchlistCount})
            </button>

            <PWAInstallButton />

            <GoogleAccountButton />

            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="API Key Settings"
              title="Change TMDB API Key"
              className="glass-chip flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 hover:text-white"
            >
              <Settings className="h-4 w-4" />
            </button>
          </nav>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (Compact <= 56px) */}
      <nav
        aria-label="Mobile Navigation"
        className="glass-panel fixed right-0 bottom-0 left-0 z-40 grid h-14 grid-cols-5 items-center border-x-0 border-b-0 md:hidden"
      >
        <button
          type="button"
          onClick={() => {
            onNavigate('discover');
            onSelectContentType('all');
          }}
          className={`flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'discover' && contentType === 'all'
              ? 'text-cyan-300'
              : 'text-slate-400'
          }`}
        >
          <Compass className="h-5 w-5" />
          <span>Discover</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onNavigate('discover');
            onSelectContentType('movie');
          }}
          className={`flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'discover' && contentType === 'movie'
              ? 'text-cyan-300'
              : 'text-slate-400'
          }`}
        >
          <Film className="h-5 w-5" />
          <span>Movies</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onNavigate('discover');
            onSelectContentType('tv');
          }}
          className={`flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'discover' && contentType === 'tv'
              ? 'text-cyan-300'
              : 'text-slate-400'
          }`}
        >
          <Tv className="h-5 w-5" />
          <span>Series</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('lists')}
          className={`flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            activeView === 'lists' ? 'text-cyan-300' : 'text-slate-400'
          }`}
        >
          <Bookmark className="h-5 w-5" />
          <span>Lists ({totalWatchlistCount})</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-slate-400"
        >
          <Settings className="h-5 w-5" />
          <span>Key</span>
        </button>
      </nav>
    </>
  );
};
