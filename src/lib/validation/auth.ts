import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(60),
  password: z.string().min(1, "Password is required").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;
