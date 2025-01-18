import z from 'zod';

export type ServiceDescriptor = z.infer<typeof ServiceDescriptor>;
export const ServiceDescriptor = z.object({
  serviceId: z.string().max(16),
  image: z.string().max(32),
  ingress: z.object({
    containerPort: z.number().min(1).max(65_535),
    public: z.boolean().optional(),
    authorizedUsers: z.array(z.string()).optional(),
  }),
  volumes: z.array(
    z.object({
      hostPath: z.string(),
      containerPath: z.string(),
    }),
  ).optional(),
});
