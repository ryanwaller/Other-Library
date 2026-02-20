import { Platform, Text as RNText, type TextProps, View, type ViewProps } from "react-native";

export function Screen(props: ViewProps) {
  return (
    <View
      {...props}
      style={[
        {
          flex: 1,
          padding: 16,
          backgroundColor: "#fff"
        },
        props.style
      ]}
    />
  );
}

export function Text(props: TextProps) {
  return (
    <RNText
      {...props}
      style={[
        {
          fontSize: 13,
          lineHeight: 18,
          color: "#111",
          fontFamily: Platform.select({ ios: "Times New Roman", android: "serif", default: "serif" })
        },
        props.style
      ]}
    />
  );
}

