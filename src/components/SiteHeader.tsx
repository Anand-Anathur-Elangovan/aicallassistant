"use client";

const PDF_HREF = "/never-miss-a-customer-call-again.pdf";

type SiteHeaderProps = {
  darkToggle?: boolean;
  dark?: boolean;
  onToggleDark?: () => void;
  rightSlot?: React.ReactNode;
};

export function SiteHeader({ darkToggle, dark, onToggleDark, rightSlot }: SiteHeaderProps) {
  return (
    <header className="border-b px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-lg sm:text-xl font-bold truncate">AI Receptionist</h1>
          <span className="text-gray-400 text-sm hidden sm:inline">by</span>
          <a
            href="https://nexcrafttech.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm sm:text-base font-semibold text-blue-600 hover:underline"
          >
            NexCraft Tech
          </a>
        </div>
        <a
          href="https://nexcrafttech.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:underline"
        >
          nexcrafttech.com
        </a>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <a
          href={PDF_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50"
        >
          View Pitch PDF
        </a>
        {darkToggle && (
          <button
            type="button"
            onClick={onToggleDark}
            className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50"
            aria-label="Toggle dark mode"
          >
            {dark ? "Light" : "Dark"}
          </button>
        )}
        {rightSlot}
      </div>
    </header>
  );
}
