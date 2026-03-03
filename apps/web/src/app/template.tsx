export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="om-page-transition">
      {children}
    </div>
  );
}
