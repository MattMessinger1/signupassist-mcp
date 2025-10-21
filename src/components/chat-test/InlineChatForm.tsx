import { useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface FormField {
  id: string;
  label: string;
  type: "text" | "checkbox";
  required?: boolean;
}

interface InlineChatFormProps {
  title: string;
  fields: FormField[];
  onSubmit: (values: Record<string, any>) => void;
  submitLabel?: string;
}

export function InlineChatForm({
  title,
  fields,
  onSubmit,
  submitLabel = "Submit"
}: InlineChatFormProps) {
  const [values, setValues] = useState<Record<string, any>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <Card className="mt-3 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {fields.map((field) => (
            <div key={field.id} className="space-y-2">
              {field.type === "text" && (
                <>
                  <Label htmlFor={field.id} className="text-sm">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <Input
                    id={field.id}
                    required={field.required}
                    value={values[field.id] || ""}
                    onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                    className="h-9"
                  />
                </>
              )}
              {field.type === "checkbox" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={field.id}
                    required={field.required}
                    checked={values[field.id] || false}
                    onCheckedChange={(checked) => setValues({ ...values, [field.id]: checked })}
                  />
                  <Label htmlFor={field.id} className="text-sm font-normal cursor-pointer">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                </div>
              )}
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <Button type="submit" size="sm" className="w-full">
            {submitLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
