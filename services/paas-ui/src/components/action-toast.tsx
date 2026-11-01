import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { ToastLifetime } from "./toast-lifetime.ts";

/** Mount a new toast for each completed action; pending actions remove old feedback. */
export const ActionToast = ({ message, error = false }: { message: string; error?: boolean }) => {
	const [visible, setVisible] = useState(true);
	const [lifetime] = useState(() => new ToastLifetime(() => setVisible(false)));
	useEffect(() => {
		lifetime.restart();
		return () => lifetime.pause();
	}, [lifetime]);
	if (!visible) return undefined;
	return (
		<div
			className={`action-toast${error ? " action-toast-error" : ""}`}
			onMouseEnter={() => lifetime.pause()}
			onMouseLeave={() => lifetime.restart()}
		>
			<p role={error ? "alert" : "status"}>{message}</p>
			<button type='button' aria-label='Dismiss notification' onClick={() => lifetime.dismiss()}>
				<X aria-hidden='true' />
			</button>
		</div>
	);
};
