import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: "OM Library",
        headerTitleStyle: {
          fontFamily: "Times New Roman"
        }
      }}
    />
  );
}

