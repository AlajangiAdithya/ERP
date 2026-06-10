import { Search } from 'lucide-react';

export default function SearchBar({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="relative group">
      <Search
        size={17}
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 bg-white border border-navy-200 rounded-lg text-sm text-navy-800
          placeholder:text-gray-400 shadow-sm transition-all duration-150 hover:border-navy-300
          focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-600"
      />
    </div>
  );
}
