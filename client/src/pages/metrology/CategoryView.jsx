import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import CalibrationList from './CalibrationList';
import { UNIFIED_CATEGORIES, CATEGORY_CARDS } from '../Metrology';

// Per-category focused page reached from a dashboard card. Reuses the same
// unified register but pre-selects the bucket so the table only shows that
// category's items.
export default function CategoryView() {
  const { slug } = useParams();
  const card = CATEGORY_CARDS.find((c) => c.slug === slug);

  if (!card) {
    return (
      <div className="rounded-2xl bg-white p-6 ring-1 ring-gray-200 shadow-card">
        <p className="text-gray-700 font-medium">Unknown category.</p>
        <Link
          to="/metrology"
          className="mt-3 inline-flex items-center gap-1 text-sm text-navy-600 hover:text-navy-800"
        >
          <ChevronLeft size={14} /> Back to Metrology
        </Link>
      </div>
    );
  }

  return (
    <CalibrationList
      title={card.label}
      defaultName=""
      unifiedCategories={UNIFIED_CATEGORIES}
      initialBucket={card.value}
    />
  );
}
