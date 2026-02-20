import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../src/supabaseClient";
import { Screen, Text } from "../src/ui";

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        borderWidth: 1,
        borderColor: "#ddd",
        paddingVertical: 8,
        paddingHorizontal: 10,
        opacity: disabled ? 0.5 : 1
      }}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signUp() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  return (
    <View style={{ gap: 10 }}>
      <Text>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        style={{ borderWidth: 1, borderColor: "#ddd", padding: 8 }}
      />
      <Text>Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ borderWidth: 1, borderColor: "#ddd", padding: 8 }}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button label="Sign in" onPress={signIn} disabled={busy || !email || !password} />
        <Button label="Sign up" onPress={signUp} disabled={busy || !email || !password} />
      </View>
      {error ? <Text style={{ color: "#666" }}>{error}</Text> : null}
      <Text style={{ color: "#666" }}>Followers-only by default; public is optional later.</Text>
    </View>
  );
}

function AppShell({ session }: { session: Session }) {
  const [username, setUsername] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username,visibility")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!alive) return;
      setUsername(data?.username ?? null);
      setVisibility(data?.visibility ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [session.user.id]);

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: "#666" }}>Signed in as {username ? `@${username}` : session.user.id}</Text>
      <Text style={{ color: "#666" }}>Profile visibility: {visibility ?? "…"}</Text>
      <Button label="Sign out" onPress={() => supabase.auth.signOut()} />
      <Text>Catalog placeholder (next: add-by-ISBN + list)</Text>
    </View>
  );
}

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  return <Screen>{session ? <AppShell session={session} /> : <SignIn />}</Screen>;
}

