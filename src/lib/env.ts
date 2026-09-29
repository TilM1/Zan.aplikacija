/** Public (browser-safe) configuration. */
export const env = {
  supabaseUrl: required(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: required(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ),
};

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}
