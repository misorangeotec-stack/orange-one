interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  highlightWord?: string;
  description?: string;
  light?: boolean;
}

const SectionHeader = ({ eyebrow, title, highlightWord, description, light = true }: SectionHeaderProps) => {
  const renderTitle = () => {
    if (!highlightWord) return title;
    const parts = title.split(highlightWord);
    return (
      <>
        {parts[0]}
        <span className="text-primary">{highlightWord}</span>
        {parts[1]}
      </>
    );
  };

  return (
    <div className="mx-auto max-w-2xl text-center mb-12 md:mb-16">
      {eyebrow && (
        <span className="inline-flex items-center rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary mb-4">
          {eyebrow}
        </span>
      )}
      <h2
        className={`text-2xl md:text-[36px] font-extrabold leading-tight tracking-tight ${
          light ? "text-foreground" : "text-white"
        }`}
      >
        {renderTitle()}
      </h2>
      {description && (
        <p className={`mt-4 text-base leading-relaxed max-w-xl mx-auto ${light ? "text-muted-foreground" : "text-white/60"}`}>
          {description}
        </p>
      )}
    </div>
  );
};

export { SectionHeader };
