import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api/axios';

export function useFetch(url, options = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Stabilise the params dependency by hashing once per render instead of
  // re-stringifying inside the useCallback dep array.
  const paramsKey = useMemo(
    () => (options.params ? JSON.stringify(options.params) : ''),
    [options.params],
  );

  const abortRef = useRef(null);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request from the previous render before issuing a new one.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const { data: result } = await api.get(url, {
        params: options.params,
        signal: controller.signal,
      });
      setData(result);
    } catch (err) {
      // Abort errors are expected when the component unmounts or params change.
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, paramsKey]);

  useEffect(() => {
    fetchData();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
