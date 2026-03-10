import { getSeriesData, formatDate, getGenreForSeries } from '@/lib/books'
import SeriesClient from './SeriesClient'

export default function SeriesPage() {
  const series = getSeriesData()
  return <SeriesClient series={series} />
}
