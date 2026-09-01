import { useState, useEffect } from 'react';
import api from '../api/axios';
import { MATERIAL_CATEGORIES } from '../utils/materialTypes';

// The material-code register (category → reserved code block → what belongs in
// it), fetched once per mount. Falls back to the bundled copy in
// utils/materialTypes.js if the call fails, so a dropdown is never empty.
//
// Returns { categories, labels, loading }.
export default function useMaterialCategories() {
  const [categories, setCategories] = useState(MATERIAL_CATEGORIES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get('/products/material-categories')
      .then(({ data }) => {
        if (alive && Array.isArray(data) && data.length) setCategories(data);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return { categories, labels: categories.map((c) => c.label), loading };
}
