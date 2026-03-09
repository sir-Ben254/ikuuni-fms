// Supabase Client Configuration for Frontend
// Replace with your Supabase credentials

const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

// For production, use environment variables
// const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const _supabase = {
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY,
  
  // HTTP methods
  async request(endpoint, options = {}) {
    const url = `${this.url}/rest/v1/${endpoint}`;
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : null
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Request failed');
      }
      
      return { data, response };
    } catch (error) {
      console.error('Supabase request error:', error);
      throw error;
    }
  },

  // Select
  from(table) {
    return {
      select: (columns = '*') => ({
        eq: (column, value) => this.request(`${table}?${columns}=eq.${value}`),
        gte: (column, value) => this.request(`${table}?${columns}=gte.${value}`),
        lte: (column, value) => this.request(`${table}?${columns}=lte.${value}`),
        ilike: (column, value) => this.request(`${table}?${columns}=ilike.*${value}*`),
        order: (column, options = {}) => {
          const asc = options.ascending !== false ? 'asc' : 'desc';
          return this.request(`${table}?${columns}&order=${column}.${asc}`);
        },
        limit: (count) => this.request(`${table}?${columns}&limit=${count}`),
        single: async () => {
          const { data, response } = await this.request(`${table}?${columns}&limit=1`);
          return { data: data[0], response };
        }
      }),
      insert: (data) => this.request(table, { method: 'POST', body: data }),
      update: (data, filters) => {
        const filterStr = Object.entries(filters).map(([k, v]) => `${k}=eq.${v}`).join('&');
        return this.request(`${table}?${filterStr}`, { method: 'PATCH', body: data });
      },
      delete: (filters) => {
        const filterStr = Object.entries(filters).map(([k, v]) => `${k}=eq.${v}`).join('&');
        return this.request(`${table}?${filterStr}`, { method: 'DELETE' });
      }
    };
  }
};

// API Helper that uses Supabase
const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const baseUrl = 'http://localhost:3000/api';
  
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers
      }
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};

// Export for use in app.js
window.supabase = _supabase;
window.apiCall = apiCall;
