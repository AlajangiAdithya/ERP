import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <p className="text-[13px] text-gray-500 tnum">
        Page <span className="font-semibold text-navy-700">{page}</span> of{' '}
        <span className="font-semibold text-navy-700">{totalPages}</span>
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="p-1.5 rounded-lg border border-navy-200 bg-white text-navy-600 shadow-sm transition-colors
            hover:bg-navy-50 hover:border-navy-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          <ChevronLeft size={16} />
        </button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let pageNum;
          if (totalPages <= 5) {
            pageNum = i + 1;
          } else if (page <= 3) {
            pageNum = i + 1;
          } else if (page >= totalPages - 2) {
            pageNum = totalPages - 4 + i;
          } else {
            pageNum = page - 2 + i;
          }
          return (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              className={`min-w-[34px] px-2.5 py-1.5 text-[13px] font-medium rounded-lg border transition-all duration-150 tnum
                ${page === pageNum
                  ? 'bg-gradient-to-b from-navy-600 to-navy-800 text-white border-navy-700 shadow-btn'
                  : 'bg-white border-navy-200 text-navy-600 shadow-sm hover:bg-navy-50 hover:border-navy-300'}`}
            >
              {pageNum}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="p-1.5 rounded-lg border border-navy-200 bg-white text-navy-600 shadow-sm transition-colors
            hover:bg-navy-50 hover:border-navy-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
