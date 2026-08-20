import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base styles
  "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
  {
    variants: {
      variant: {
        // Primary — Navy background, white text
        default:
          "bg-primary text-primary-foreground hover:bg-primary-800 shadow-ambient hover:shadow-ambient-lg",
        // Accent — Lime background, dark text
        accent:
          "bg-accent text-accent-foreground hover:bg-accent-400 shadow-[0_0_24px_rgba(191,255,0,0.2)] hover:shadow-[0_0_40px_rgba(191,255,0,0.3)]",
        // Secondary — Amber
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-700",
        // Outline — Border only
        outline:
          "border border-border bg-transparent hover:bg-muted text-foreground",
        // Ghost — No background
        ghost:
          "hover:bg-muted hover:text-foreground text-muted-foreground",
        // Link — Underline on hover
        link:
          "text-primary underline-offset-4 hover:underline",
        // Danger — Red
        danger:
          "bg-danger text-danger-foreground hover:bg-danger/90",
      },
      size: {
        sm: "h-9 px-4 text-xs",
        default: "h-11 px-6 text-sm",
        lg: "h-13 px-8 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
