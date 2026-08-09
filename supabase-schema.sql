-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Profiles (linked to Supabase Auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Businesses
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  phone TEXT,
  working_hours JSONB DEFAULT '{"mon-fri": "9:00-18:00", "sat": "10:00-14:00", "sun": "closed"}',
  language TEXT DEFAULT 'en',
  voice_id TEXT DEFAULT 'rachel',
  vapi_assistant_id TEXT,
  vapi_phone_id TEXT,
  notification_email TEXT,
  notification_telegram TEXT,
  notification_whatsapp TEXT,
  transfer_message TEXT DEFAULT 'Please hold while I connect you to a team member.',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products / Services
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  min_price DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',
  category TEXT,
  in_stock BOOLEAN DEFAULT TRUE,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge Base
CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Call Logs
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vapi_call_id TEXT,
  caller_number TEXT,
  duration_seconds INTEGER,
  transcript TEXT,
  summary TEXT,
  status TEXT DEFAULT 'completed',
  transferred BOOLEAN DEFAULT FALSE,
  transferred_to TEXT,
  language TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Human Agents (for live transfer)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  department TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Offer / Negotiation Rules
CREATE TABLE offer_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_products_business ON products(business_id);
CREATE INDEX idx_knowledge_business ON knowledge_base(business_id);
CREATE INDEX idx_calls_business ON call_logs(business_id);
CREATE INDEX idx_calls_created ON call_logs(created_at DESC);
CREATE INDEX idx_agents_business ON agents(business_id);
CREATE INDEX idx_offers_business ON offer_rules(business_id);

-- Vector similarity search indexes
CREATE INDEX idx_products_embedding ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_knowledge_embedding ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own profile" ON profiles FOR ALL USING (id = auth.uid());
CREATE POLICY "Users see own businesses" ON businesses FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users see own products" ON products FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
CREATE POLICY "Users see own knowledge" ON knowledge_base FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
CREATE POLICY "Users see own calls" ON call_logs FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
CREATE POLICY "Users see own agents" ON agents FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
CREATE POLICY "Users see own offers" ON offer_rules FOR ALL USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function for vector similarity search
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding VECTOR(1536),
  match_business_id UUID,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (id UUID, title TEXT, content TEXT, similarity FLOAT)
AS $$
BEGIN
  RETURN QUERY
  SELECT kb.id, kb.title, kb.content, 1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE kb.business_id = match_business_id
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search_products(
  query_embedding VECTOR(1536),
  match_business_id UUID,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, price DECIMAL, min_price DECIMAL, in_stock BOOLEAN, similarity FLOAT)
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.description, p.price, p.min_price, p.in_stock, 1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE p.business_id = match_business_id
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
