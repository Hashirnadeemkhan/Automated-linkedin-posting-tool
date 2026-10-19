import type { Metadata } from 'next';
import './style.css';
export const metadata:Metadata={title:'Immigration News Review',description:'Review and approve LinkedIn immigration news posts'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
