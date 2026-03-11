import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "shadcn-button",
  {
    variants: {
      variant: {
        default:     "shadcn-button--default",
        destructive: "shadcn-button--destructive",
        outline:     "shadcn-button--outline",
        secondary:   "shadcn-button--secondary",
        ghost:       "shadcn-button--ghost",
        link:        "shadcn-button--link",
      },
      size: {
        default: "shadcn-button--size-default",
        sm:      "shadcn-button--size-sm",
        lg:      "shadcn-button--size-lg",
        icon:    "shadcn-button--size-icon",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
