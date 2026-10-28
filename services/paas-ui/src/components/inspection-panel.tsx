import type { ReactNode } from "react";

export const InspectionPanel = ({ title, children }: { title: string; children: ReactNode }) => (
	<section className='inspection-panel'>
		<h2>{title}</h2>
		{children}
	</section>
);
