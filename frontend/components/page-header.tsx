interface PageHeaderProps {
  title: string
  description: string
}

export default function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div>
      <h1 className="text-4xl font-bold text-foreground mb-2">{title}</h1>
      <p className="text-muted-foreground text-lg">{description}</p>
    </div>
  )
}
