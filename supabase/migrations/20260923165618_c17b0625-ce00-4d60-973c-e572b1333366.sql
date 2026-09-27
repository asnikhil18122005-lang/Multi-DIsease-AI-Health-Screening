CREATE TABLE public.screenings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  patient_ref TEXT,
  models_run INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  results_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX screenings_device_created_idx ON public.screenings (device_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.screenings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screenings TO authenticated;
GRANT ALL ON public.screenings TO service_role;

ALTER TABLE public.screenings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create a screening record"
  ON public.screenings FOR INSERT
  TO anon, authenticated
  WITH CHECK (device_id IS NOT NULL AND length(device_id) > 0);

CREATE POLICY "Screenings are readable"
  ON public.screenings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Screenings can be deleted"
  ON public.screenings FOR DELETE
  TO anon, authenticated
  USING (true);